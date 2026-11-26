//! Batería por distro del escáner (`npm run test:distros`, ver `scripts/distro-test/run.mjs`).
//!
//! Dos pruebas `#[ignore]` que llama el ejecutor con `SSHORUS_DISTRO_DIR` apuntando a su carpeta temporal:
//! - `distro_scripts_dump`: escribe los scripts REALES de las fases 1, 1b y 2 (los mismos que pide la
//!   interfaz) en `<dir>/scripts/`, para ejecutarlos en cada contenedor.
//! - `distro_outputs_check`: lee lo que devolvió cada contenedor (`<dir>/out/<distro>/`) con los mismos
//!   parseadores del análisis y escribe el veredicto en `<dir>/out/<distro>/rust.tsv`
//!   («área<TAB>ok|fail<TAB>detalle»). No falla por un ✗: el ejecutor lo cuenta y lo enseña.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use super::ecosystem;
use super::model::PackageManager;
use super::parse::inventory;
use super::plan::{plan_from, users_view};
use super::scripts;

fn base_dir() -> PathBuf {
    PathBuf::from(std::env::var("SSHORUS_DISTRO_DIR").expect("falta SSHORUS_DISTRO_DIR (lo pone npm run test:distros)"))
}

#[test]
#[ignore]
fn distro_scripts_dump() {
    let dir = base_dir().join("scripts");
    fs::create_dir_all(&dir).unwrap();
    for (name, body) in [
        ("detect", scripts::detect_script()),
        ("users", scripts::users_script()),
        ("inventory", scripts::inventory_script()),
    ] {
        fs::write(dir.join(format!("{name}.sh")), body).unwrap();
    }
}

/// `clave=valor` por línea (lo escribe el ejecutor con lo que se espera de la distro).
fn read_expect(p: &Path) -> HashMap<String, String> {
    fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
        .collect()
}

fn pm_name(pm: Option<PackageManager>) -> String {
    pm.map(|p| format!("{p:?}").to_lowercase()).unwrap_or_else(|| "none".into())
}

type Verdict = Result<String, String>;

fn check_detect(out: &str, exp: &HashMap<String, String>) -> Verdict {
    let d = inventory::parse_detect(out);
    let p = plan_from(out);
    let want = |k: &str| exp.get(k).cloned().unwrap_or_default();
    if !d.complete {
        return Err("salida incompleta (sin @@end)".into());
    }
    if d.os.id != want("os") {
        return Err(format!("distro «{}», se esperaba «{}»", d.os.id, want("os")));
    }
    if pm_name(d.pm) != want("pm") {
        return Err(format!("gestor «{}», se esperaba «{}»", pm_name(d.pm), want("pm")));
    }
    if d.user != want("user") || d.uid == Some(0) || p.is_root {
        return Err(format!("usuario «{}» (uid {:?})", d.user, d.uid));
    }
    if !d.in_container {
        return Err("no detecta que es un contenedor".into());
    }
    let eco = p.ecosystem.clone().unwrap_or_else(|| "none".into());
    if eco != want("ecosystem") {
        return Err(format!("ecosistema OSV «{eco}», se esperaba «{}»", want("ecosystem")));
    }
    let tool = p.distro_tool.map(|t| format!("{t:?}").to_lowercase()).unwrap_or_else(|| "none".into());
    if tool != want("tool") {
        return Err(format!("herramienta de la distro «{tool}», se esperaba «{}»", want("tool")));
    }
    let why = if p.ecosystem.is_none() { format!(" ({})", ecosystem::no_osv_reason(&d.os)) } else { String::new() };
    Ok(format!("{} · {} · OSV {eco}{why} · herramienta {tool} · kernel {}", p.os, pm_name(d.pm), d.kernel))
}

fn check_users(out: &str) -> Verdict {
    if !out.contains("@@end") {
        return Err("salida incompleta (¿falló sudo?)".into());
    }
    let u = users_view(out);
    Ok(format!("{} usuarios con contenedores propios (ninguno es lo normal aquí)", u.users.len()))
}

fn check_inventory(out: &str, exp: &HashMap<String, String>) -> Verdict {
    let inv = inventory::parse_inventory(out);
    if !inv.complete {
        return Err("salida incompleta (sin @@end)".into());
    }
    let want_pm = exp.get("pm").cloned().unwrap_or_default();
    if pm_name(inv.pm) != want_pm {
        return Err(format!("gestor «{}», se esperaba «{want_pm}»", pm_name(inv.pm)));
    }
    if inv.packages.len() < 20 {
        return Err(format!("solo {} paquetes leídos", inv.packages.len()));
    }
    let bad: Vec<_> = inv.packages.iter().filter(|p| p.name.is_empty() || p.version.is_empty()).collect();
    if !bad.is_empty() {
        return Err(format!("{} paquetes sin nombre o versión", bad.len()));
    }
    for name in ["sshd", "sudo"] {
        let Some(p) = inv.programs.iter().find(|p| p.name == name) else {
            return Err(format!("no encuentra el programa {name}"));
        };
        if p.owner.as_deref().unwrap_or("").is_empty() {
            return Err(format!("{name} ({}) sin paquete dueño", p.path));
        }
        if p.version_line.trim().is_empty() {
            return Err(format!("{name} sin versión"));
        }
    }
    let progs: Vec<String> = inv
        .programs
        .iter()
        .map(|p| format!("{}←{}", p.name, p.owner.as_deref().unwrap_or("?")))
        .collect();
    Ok(format!("{} paquetes ({}) · programas: {}", inv.packages.len(), pm_name(inv.pm), progs.join(", ")))
}

#[test]
#[ignore]
fn distro_outputs_check() {
    let out_dir = base_dir().join("out");
    let Ok(entries) = fs::read_dir(&out_dir) else { return };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let exp = read_expect(&dir.join("expect.txt"));
        let read = |n: &str| fs::read_to_string(dir.join(format!("vuln-{n}.txt"))).ok();
        let mut lines = Vec::new();
        for (area, verdict) in [
            ("vuln-detect", read("detect").map(|o| check_detect(&o, &exp))),
            ("vuln-users", read("users").map(|o| check_users(&o))),
            ("vuln-inventory", read("inventory").map(|o| check_inventory(&o, &exp))),
        ] {
            let (ok, detail) = match verdict {
                Some(Ok(d)) => ("ok", d),
                Some(Err(e)) => ("fail", e),
                None => ("fail", "no se ejecutó".to_string()),
            };
            lines.push(format!("{area}\t{ok}\t{}", detail.replace(['\t', '\n'], " ")));
        }
        fs::write(dir.join("rust.tsv"), lines.join("\n") + "\n").unwrap();
    }
}
