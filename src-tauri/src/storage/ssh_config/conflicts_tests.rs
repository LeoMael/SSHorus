//! Pruebas de choques de alias con `Host`/`Match` escritos a mano.

use std::collections::{BTreeMap, HashSet};
use std::fs;

use super::alias::update_overrides;
use super::conflicts::{alias_info, conflicts, SshAliasConflict};
use super::export::export;
use super::tests::{srv, Tmp};
use super::*;

/// Resumen compacto de choques: `alias: pattern@archivo:línea(kind[,antes][,cond])`.
fn summary(c: &[SshAliasConflict]) -> Vec<String> {
    c.iter()
        .map(|c| {
            let m: Vec<String> = c
                .matches
                .iter()
                .map(|m| {
                    let mut s = format!("{}@{}:{}({}", m.pattern, m.file, m.line, m.kind);
                    if m.before_sshorus {
                        s.push_str(",antes");
                    }
                    if m.conditional {
                        s.push_str(",cond");
                    }
                    s.push(')');
                    s
                })
                .collect();
            format!("{} -> {} [{}]", c.alias, c.suggestion, m.join(" "))
        })
        .collect()
}

#[test]
fn conflicts_exact_patterns_case_include_and_match() {
    let t = Tmp::new();
    let env = t.env();
    t.write(
        ".ssh/config",
        &format!(
            "Include conf.d/*\n\
             \n\
             {BEGIN_MARKER}\nHost web\n    HostName 10.0.0.1\n{END_MARKER}\n\
             \n\
             Host WEB\n\
             \x20   User manual\n\
             Host db?? !db-tv\n\
             \x20   Port 2200\n\
             Host *-lan !nas-lan\n\
             Match originalhost cache exec \"true\"\n\
             Match host 10.9.9.9\n\
             Match all\n\
             Host *\n\
             \x20   ServerAliveInterval 30\n"
        ),
    );
    t.write(".ssh/conf.d/trabajo", "Host api\n    HostName api.example.com\n");
    let servers = [
        srv("web", "10.0.0.1", 22, "u", None),
        srv("db01", "db.lan", 22, "u", None),
        srv("nas lan", "nas.lan", 22, "u", None),
        srv("caja lan", "caja.lan", 22, "u", None),
        srv("api", "api.example.com", 22, "u", None),
        srv("cache", "cache.lan", 22, "u", None),
        srv("monitor", "10.9.9.9", 22, "u", None),
        srv("libre", "libre.example.com", 22, "u", None),
    ];
    let got = conflicts(&env, &servers).unwrap();
    assert_eq!(
        summary(&got),
        [
            // Mayúsculas: ssh compara sin distinguirlas. El bloque propio no cuenta.
            "web -> web-tv [WEB@~/.ssh/config:8(exact)]",
            "db01 -> db01-tv [db??@~/.ssh/config:10(pattern)]",
            // nas-lan está excluido con `!nas-lan`; caja-lan, no.
            "caja-lan -> caja-lan-tv [*-lan@~/.ssh/config:12(pattern)]",
            // Include al principio: va antes del bloque → sus valores ganan.
            "api -> api-tv [api@~/.ssh/conf.d/trabajo:1(exact,antes)]",
            // `Match` con `exec`: puede que no aplique siempre.
            "cache -> cache-tv [cache@~/.ssh/config:13(match,cond)]",
            // `Match host` compara con el HostName.
            "monitor -> monitor-tv [10.9.9.9@~/.ssh/config:14(match)]",
        ]
    );
    assert!(got.iter().all(|c| !c.custom));
}

#[test]
fn conflicts_without_block_use_insert_position() {
    let t = Tmp::new();
    let env = t.env();
    // Sin bloque todavía: se insertará antes del primer Host → el Host va después.
    t.write(".ssh/config", "Host web\n  User a\n");
    let got = conflicts(&env, &[srv("web", "h", 22, "u", None)]).unwrap();
    assert_eq!(summary(&got), ["web -> web-tv [web@~/.ssh/config:1(exact)]"]);
    // Sin archivo: nada.
    fs::remove_file(&env.config).unwrap();
    assert!(conflicts(&env, &[srv("web", "h", 22, "u", None)]).unwrap().is_empty());
    // Solo `Host *` y `Match all`: no son choques.
    t.write(".ssh/config", "Host *\n  User x\nMatch all\n  Port 1\nHost **\n");
    assert!(conflicts(&env, &[srv("web", "h", 22, "u", None)]).unwrap().is_empty());
}

#[test]
fn custom_aliases_fix_conflicts_and_export() {
    let t = Tmp::new();
    let env = t.env();
    t.write(".ssh/config", "Host web web-tv\n  User mano\n");
    let a = srv("web", "10.0.0.1", 22, "u", None);
    let b = srv("Web", "10.0.0.2", 22, "u", None);
    let servers = [a.clone(), b.clone()];
    let got = conflicts(&env, &servers).unwrap();
    // web-tv ya existe a mano → web-tv2. El segundo se llama web-2 (no choca).
    assert_eq!(summary(&got), ["web -> web-tv2 [web@~/.ssh/config:1(exact)]"]);

    // Elegir el alias propuesto: se guarda y se usa al exportar.
    let ids: HashSet<String> = servers.iter().map(|s| s.id.clone()).collect();
    let mut ch = BTreeMap::new();
    ch.insert(a.id.clone(), Some(" WEB-tv2 ".to_string()));
    ch.insert("borrado".to_string(), Some("x".to_string()));
    let map = update_overrides(&env, &ch, &ids).unwrap();
    assert_eq!(map.get(&a.id).map(String::as_str), Some("web-tv2"));
    assert!(!map.contains_key("borrado"));
    export(&env, &servers).unwrap();
    let text = fs::read_to_string(&env.config).unwrap();
    assert!(text.contains("Host web-tv2\n    HostName 10.0.0.1"));
    // El automático del segundo pasa a ser `web` (el nombre quedó libre)… y choca.
    assert!(text.contains("Host web\n    HostName 10.0.0.2"));
    let got = conflicts(&env, &servers).unwrap();
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].server_id, b.id);

    // Alias inválidos: no se guarda nada.
    let mut bad = BTreeMap::new();
    bad.insert(b.id.clone(), Some("web *".to_string()));
    assert!(update_overrides(&env, &bad, &ids).is_err());
    assert_eq!(load_overrides(&env).len(), 1);
    // Volver al automático.
    let mut back = BTreeMap::new();
    back.insert(a.id.clone(), None);
    assert!(update_overrides(&env, &back, &ids).unwrap().is_empty());
}

#[test]
fn alias_info_for_draft_server() {
    let t = Tmp::new();
    let env = t.env();
    t.write(".ssh/config", "Host prod*\n  User mano\n");
    let existing = [srv("prod", "a", 22, "u", None)];
    // Nuevo servidor llamado «Prod»: sería `prod-2` (prod ya lo usa otro) y lo captura `prod*`.
    let mut draft = srv("Prod", "b", 22, "u", None);
    draft.id = String::new();
    let info = alias_info(&env, &existing, draft.clone(), None).unwrap();
    assert_eq!(info.alias, "prod-2");
    assert_eq!(info.matches.len(), 1);
    assert_eq!(info.matches[0].pattern, "prod*");
    // `prod-2-tv…` también empiezan por «prod» → se propone con prefijo.
    assert_eq!(info.suggestion.as_deref(), Some("tv-prod-2"));
    // Con alias propio libre: sin choques.
    let info = alias_info(&env, &existing, draft.clone(), Some("Backend")).unwrap();
    assert_eq!(info.alias, "backend");
    assert!(info.matches.is_empty() && info.suggestion.is_none());
    // Alias inválido: error.
    assert!(alias_info(&env, &existing, draft, Some("a?b")).is_err());
    // Editar el existente: mismo id → no cuenta como otro.
    let info = alias_info(&env, &existing, existing[0].clone(), None).unwrap();
    assert_eq!(info.alias, "prod");
}
