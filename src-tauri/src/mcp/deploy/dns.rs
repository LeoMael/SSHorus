//! `check_dns`: ¿el dominio apunta a este servidor? Se pregunta desde el servidor (con `dig` a un DNS
//! público si lo hay, que no tiene caché vieja; si no, `getent`) y se compara con sus IP: las de sus
//! interfaces y la de la dirección con la que SSHorus se conecta (por si está detrás de NAT).

use std::collections::BTreeSet;
use std::net::IpAddr;

use super::super::template::shell_quote;

/// Comando de solo lectura (sin sudo). `host` = dirección del servidor guardada en SSHorus.
pub fn probe_command(domain: &str, host: &str) -> String {
    let d = shell_quote(domain);
    let h = shell_quote(host);
    [
        "echo @@iface".to_string(),
        "if command -v ip >/dev/null 2>&1; then ip -o addr show scope global | awk '{print $4}' | cut -d/ -f1; \
         else hostname -I 2>/dev/null | tr ' ' '\\n'; fi"
            .into(),
        "echo @@domain".into(),
        format!(
            "r=''; if command -v dig >/dev/null 2>&1; then r=$(dig +short +time=3 +tries=1 A {d} @1.1.1.1 2>/dev/null; \
             dig +short +time=3 +tries=1 AAAA {d} @1.1.1.1 2>/dev/null); fi; \
             if [ -z \"$r\" ]; then r=$(getent ahosts {d} 2>/dev/null | awk '{{print $1}}' | sort -u); fi; printf '%s\\n' \"$r\""
        ),
        "echo @@host".into(),
        format!("getent ahosts {h} 2>/dev/null | awk '{{print $1}}' | sort -u"),
        "true".into(),
    ]
    .join("\n")
}

/// Lo que se leyó del servidor.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct DnsProbe {
    /// IP del dominio.
    pub domain: BTreeSet<IpAddr>,
    /// IP de las interfaces y de la dirección guardada en SSHorus.
    pub server: BTreeSet<IpAddr>,
    /// Solo las de la dirección guardada (la más probable para el registro A).
    pub host: BTreeSet<IpAddr>,
}

/// IP que sirven: ni loopback, ni enlace local, ni sin especificar.
fn useful(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => !v.is_loopback() && !v.is_link_local() && !v.is_unspecified(),
        IpAddr::V6(v) => {
            !v.is_loopback() && !v.is_unspecified() && (v.segments()[0] & 0xffc0) != 0xfe80
        }
    }
}

/// Privada o de uso interno (no vale para un registro DNS público).
pub fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private() || (v.octets()[0] == 100 && (v.octets()[1] & 0xc0) == 64),
        IpAddr::V6(v) => (v.segments()[0] & 0xfe00) == 0xfc00,
    }
}

/// Lee la salida de `probe_command`. `host` = dirección guardada (si ya es una IP, cuenta como del servidor).
pub fn parse(stdout: &str, host: &str) -> DnsProbe {
    let mut p = DnsProbe::default();
    if let Ok(ip) = host.trim().trim_matches(['[', ']']).parse::<IpAddr>() {
        p.host.insert(ip);
    }
    let mut section = "";
    for line in stdout.lines().map(str::trim) {
        if let Some(s) = line.strip_prefix("@@") {
            section = if matches!(s, "iface" | "domain" | "host") {
                s
            } else {
                ""
            };
            continue;
        }
        let Ok(ip) = line.parse::<IpAddr>() else {
            continue;
        };
        if !useful(&ip) {
            continue;
        }
        match section {
            "iface" => {
                p.server.insert(ip);
            }
            "domain" => {
                p.domain.insert(ip);
            }
            "host" => {
                p.host.insert(ip);
            }
            _ => {}
        }
    }
    let host_ips: Vec<IpAddr> = p.host.iter().copied().collect();
    p.server.extend(host_ips);
    p
}

/// Resultado para la IA.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DnsVerdict {
    /// Todas las IP del dominio son del servidor.
    Here,
    /// Algunas sí y otras no (p. ej. un AAAA viejo): Let's Encrypt puede fallar.
    Partly { elsewhere: Vec<IpAddr> },
    /// Apunta a otro sitio (otro servidor o un proxy tipo Cloudflare).
    Elsewhere,
    /// No resuelve.
    Missing,
}

pub fn verdict(p: &DnsProbe) -> DnsVerdict {
    if p.domain.is_empty() {
        return DnsVerdict::Missing;
    }
    let elsewhere: Vec<IpAddr> = p
        .domain
        .iter()
        .filter(|ip| !p.server.contains(ip))
        .copied()
        .collect();
    if elsewhere.is_empty() {
        DnsVerdict::Here
    } else if elsewhere.len() == p.domain.len() {
        DnsVerdict::Elsewhere
    } else {
        DnsVerdict::Partly { elsewhere }
    }
}

/// IP que el usuario debería poner en el registro: pública, primero IPv4 y primero la de la dirección guardada.
pub fn suggested_ip(p: &DnsProbe) -> Option<IpAddr> {
    let public = |set: &BTreeSet<IpAddr>, v4: bool| {
        set.iter()
            .find(|ip| !is_private(ip) && ip.is_ipv4() == v4)
            .copied()
    };
    public(&p.host, true)
        .or_else(|| public(&p.server, true))
        .or_else(|| public(&p.host, false))
        .or_else(|| public(&p.server, false))
}

fn list(ips: &BTreeSet<IpAddr>) -> String {
    if ips.is_empty() {
        "ninguna".into()
    } else {
        ips.iter()
            .map(IpAddr::to_string)
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// Texto para la IA: qué pasa y qué hacer.
pub fn render(domain: &str, p: &DnsProbe) -> String {
    let record = |ip: &IpAddr| if ip.is_ipv4() { "A" } else { "AAAA" };
    let ask = match suggested_ip(p) {
        Some(ip) => format!("Pide al usuario que cree en su proveedor de DNS un registro {} «{domain}» → {ip} y vuelve a llamar a check_dns en unos minutos.", record(&ip)),
        None => "No se encontró una IP pública del servidor (¿está detrás de NAT?): pregunta al usuario qué IP pública tiene y que cree el registro A con ella.".into(),
    };
    let head = format!(
        "Dominio {domain}: {}\nIP del servidor: {}",
        list(&p.domain),
        list(&p.server)
    );
    let body = match verdict(p) {
        DnsVerdict::Here => "✓ El dominio apunta a este servidor: puedes crear el sitio (Caddy pide el certificado HTTPS solo; hacen falta los puertos 80 y 443 abiertos).".to_string(),
        DnsVerdict::Partly { elsewhere } => {
            let ips: Vec<String> = elsewhere.iter().map(IpAddr::to_string).collect();
            format!(
                "⚠ Apunta en parte a este servidor, pero también a {}. Let's Encrypt puede probar esas y fallar (pasa mucho con un AAAA viejo): pide al usuario que las quite o las cambie.",
                ips.join(", ")
            )
        }
        DnsVerdict::Elsewhere => format!(
            "✗ El dominio apunta a otro sitio. Si usa un proxy (Cloudflare con la nube naranja) puede ser normal, pero el certificado tendrá que hacerse de otra forma. Si no: {ask}"
        ),
        DnsVerdict::Missing => format!("✗ El dominio no resuelve todavía. {ask} Mientras tanto se puede desplegar solo con IP:puerto (deploy_app con public=true y abrir el puerto en el cortafuegos)."),
    };
    let private = p.server.iter().all(is_private) && !p.server.is_empty();
    let note = if private {
        "\nNota: todas las IP conocidas del servidor son privadas: el registro DNS debe usar su IP pública."
    } else {
        ""
    };
    format!("{head}\n{body}{note}")
}
