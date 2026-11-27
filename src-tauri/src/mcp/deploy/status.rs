//! `deploy_status`: comprobar un despliegue sin sudo y sin cambiar nada: el puerto escucha, la app responde
//! en local, el dominio responde por HTTP/HTTPS con un certificado válido, el servicio del sistema está
//! activo y el usuario de la app tiene linger, su systemd en marcha y procesos.

use std::collections::BTreeMap;

use super::super::template::shell_quote;

/// Qué comprobar (ya validado con `check`). Todo opcional; al menos una cosa.
#[derive(Debug, Clone, Default)]
pub struct StatusQuery {
    pub port: Option<u16>,
    pub domain: Option<String>,
    pub unit: Option<String>,
    pub user: Option<String>,
}

impl StatusQuery {
    pub fn is_empty(&self) -> bool {
        self.port.is_none() && self.domain.is_none() && self.unit.is_none() && self.user.is_none()
    }
}

/// `fetch URL [k]`: código HTTP (000 = no responde; `k` = sin comprobar el certificado).
const FETCH: &str = "fetch() { if command -v curl >/dev/null 2>&1; then \
curl -sS -o /dev/null -w '%{http_code}' --max-time 8 ${2:+-k} \"$1\" 2>/dev/null || true; \
elif command -v wget >/dev/null 2>&1; then \
wget -q -S -O /dev/null -T 8 ${2:+--no-check-certificate} \"$1\" 2>&1 | awk '/HTTP\\//{c=$2} END{print c ? c : \"000\"}'; \
else echo none; fi; }";

/// Comando de solo lectura.
pub fn probe_command(q: &StatusQuery) -> String {
    let mut s = vec![FETCH.to_string()];
    if let Some(p) = q.port {
        s.push(format!(
            "echo \"@@listen=$({{ ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null; }} | awk '{{print $4}}' | grep -E '[:.]{p}$' | sort -u | tr '\\n' ' ')\""
        ));
        s.push(format!(
            "echo \"@@http_local=$(fetch http://127.0.0.1:{p}/)\""
        ));
    }
    if let Some(d) = &q.domain {
        let d = shell_quote(d);
        s.extend([
            format!("echo \"@@http=$(fetch http://{d}/)\""),
            format!("echo \"@@https=$(fetch https://{d}/)\""),
            format!("echo \"@@https_insecure=$(fetch https://{d}/ k)\""),
            format!(
                "if command -v openssl >/dev/null 2>&1; then echo \"@@cert=$(echo | timeout 8 openssl s_client -servername {d} -connect {d}:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)\"; fi"
            ),
        ]);
    }
    if let Some(unit) = &q.unit {
        s.push(format!(
            "echo \"@@unit=$(systemctl is-active {} 2>/dev/null)\"",
            shell_quote(unit)
        ));
    }
    if let Some(u) = &q.user {
        let u = shell_quote(u);
        s.extend([
            format!("if id {u} >/dev/null 2>&1; then echo @@user=yes; else echo @@user=no; fi"),
            format!("if [ -e /var/lib/systemd/linger/{u} ]; then echo @@linger=yes; else echo @@linger=no; fi"),
            format!("echo \"@@usermgr=$(systemctl is-active user@$(id -u {u} 2>/dev/null).service 2>/dev/null)\""),
            format!("echo \"@@procs=$(ps -u {u} -o comm= 2>/dev/null | sort | uniq -c | awk '{{print $2\"×\"$1}}' | tr '\\n' ' ')\""),
        ]);
    }
    s.push("true".into());
    s.join("\n")
}

/// `@@clave=valor` de la salida.
pub fn parse(stdout: &str) -> BTreeMap<String, String> {
    stdout
        .lines()
        .filter_map(|l| l.trim().strip_prefix("@@")?.split_once('='))
        .map(|(k, v)| (k.to_string(), v.trim().to_string()))
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    Ok,
    Warn,
    Bad,
}

impl Mark {
    fn sign(self) -> &'static str {
        match self {
            Mark::Ok => "✓",
            Mark::Warn => "⚠",
            Mark::Bad => "✗",
        }
    }
}

/// Una comprobación con su texto.
pub type Line = (Mark, String);

fn http(code: &str) -> Mark {
    match code.chars().next() {
        Some('2' | '3' | '4') => Mark::Ok,
        Some('5') => Mark::Warn,
        _ => Mark::Bad,
    }
}

/// Cómo se dice un código: «nada» si no respondió, o que no se pudo comprobar.
fn said(code: &str) -> &str {
    match code {
        "" | "000" => "nada",
        "none" => "(no se pudo comprobar: no hay curl ni wget)",
        c => c,
    }
}

/// Las comprobaciones, en orden, a partir de lo leído.
pub fn lines(q: &StatusQuery, v: &BTreeMap<String, String>) -> Vec<Line> {
    let get = |k: &str| v.get(k).map(String::as_str).unwrap_or("");
    let mut out: Vec<Line> = Vec::new();
    if let Some(p) = q.port {
        let listen = get("listen");
        out.push(match listen {
            "" => (Mark::Bad, format!("Nada escucha en el puerto {p}: la app no arrancó o usa otro puerto.")),
            l if l.split(' ').all(|a| a.starts_with("127.") || a.starts_with("[::1]") || a.starts_with("::1")) => {
                (Mark::Ok, format!("El puerto {p} escucha solo en local ({l}): bien si va detrás de Caddy o nginx."))
            }
            l => (Mark::Ok, format!("El puerto {p} escucha en {l} (todas las interfaces: mira el cortafuegos si no debe verse desde fuera).")),
        });
        let code = get("http_local");
        out.push((
            http(code),
            format!("http://127.0.0.1:{p}/ responde {}.", said(code)),
        ));
    }
    if let Some(d) = &q.domain {
        let (https, insecure) = (get("https"), get("https_insecure"));
        out.push(match (http(https), http(insecure)) {
            (Mark::Ok, _) => (Mark::Ok, format!("https://{d}/ responde {https} con un certificado válido.")),
            (Mark::Warn, _) if https == "502" || https == "503" => (
                Mark::Bad,
                format!("https://{d}/ responde {https}: el proxy no llega a la app (¿puerto equivocado, la app caída o SELinux? Con SELinux: setsebool -P httpd_can_network_connect 1)."),
            ),
            (Mark::Warn, _) => (Mark::Warn, format!("https://{d}/ responde {https} (error de la app).")),
            (Mark::Bad, Mark::Ok | Mark::Warn) => (
                Mark::Warn,
                format!("https://{d}/ responde ({insecure}) pero el certificado no es válido todavía (Caddy tarda un poco en pedirlo; si sigue, mira check_dns y los puertos 80/443)."),
            ),
            (Mark::Bad, Mark::Bad) => (Mark::Bad, format!("https://{d}/ no responde (¿falta el sitio, el DNS o abrir el 443 en el cortafuegos?).")),
        });
        let plain = get("http");
        out.push((
            http(plain),
            format!("http://{d}/ responde {}.", said(plain)),
        ));
        if let Some(cert) = v.get("cert").filter(|c| !c.is_empty()) {
            out.push((Mark::Ok, format!("El certificado caduca el {cert}.")));
        }
    }
    if let Some(unit) = &q.unit {
        let st = get("unit");
        let mark = if st == "active" { Mark::Ok } else { Mark::Bad };
        out.push((
            mark,
            format!(
                "Servicio {unit}: {}.",
                if st.is_empty() { "desconocido" } else { st }
            ),
        ));
    }
    if let Some(u) = &q.user {
        if get("user") != "yes" {
            out.push((
                Mark::Bad,
                format!("El usuario {u} no existe (créalo con create_app_user)."),
            ));
            return out;
        }
        out.push(if get("linger") == "yes" {
            (Mark::Ok, format!("{u} tiene linger: sus servicios siguen sin sesión abierta."))
        } else {
            (Mark::Warn, format!("{u} no tiene linger: sus servicios se paran al cerrar sesión (deploy_app lo activa)."))
        });
        let mgr = get("usermgr");
        out.push((
            if mgr == "active" { Mark::Ok } else { Mark::Bad },
            format!(
                "systemd de {u}: {}.",
                if mgr.is_empty() { "parado" } else { mgr }
            ),
        ));
        let procs = get("procs");
        out.push(if procs.is_empty() {
            (Mark::Bad, format!("{u} no tiene ningún proceso en marcha."))
        } else {
            (Mark::Ok, format!("Procesos de {u}: {procs}"))
        });
    }
    out
}

/// Texto para la IA: resumen y una línea por comprobación.
pub fn render(lines: &[Line]) -> String {
    let bad = lines.iter().filter(|(m, _)| *m == Mark::Bad).count();
    let warn = lines.iter().filter(|(m, _)| *m == Mark::Warn).count();
    let head = match (bad, warn) {
        (0, 0) => "Todo bien.".to_string(),
        (0, w) => format!("Funciona, con {w} aviso(s)."),
        (b, _) => format!(
            "Hay {b} problema(s). Logs del usuario de la app: run_command «sudo journalctl _UID=$(id -u USUARIO) -n 100 --no-pager»."
        ),
    };
    let body: Vec<String> = lines
        .iter()
        .map(|(m, t)| format!("{} {t}", m.sign()))
        .collect();
    format!("{head}\n{}", body.join("\n"))
}
