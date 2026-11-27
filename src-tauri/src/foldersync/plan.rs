//! Comparación inicial (qué subir al empezar) y reglas de seguridad de los borrados.

use std::collections::HashMap;

use super::model::{PlanItem, SyncPreview};
use super::snapshot::Snapshot;

/// Un archivo del servidor: tamaño y fecha (segundos Unix, si se conoce).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RemoteStamp {
    pub size: u64,
    pub mtime: Option<u64>,
}

/// Diferencia de fecha que se considera «la misma» (sistemas de archivos con 1–2 s de precisión).
const SAME_SECS: u64 = 2;

/// Más borrados que esto de una vez no se aplican en el servidor (¿carpeta movida o desmontada?).
pub const MAX_DELETES: usize = 50;

/// Compara la foto del PC con lo que hay en el servidor. Nunca propone pisar algo más nuevo
/// del servidor: eso va aparte (`remote_newer`) para preguntar.
pub fn compare(local: &Snapshot, remote: &HashMap<String, RemoteStamp>) -> SyncPreview {
    let mut p = SyncPreview {
        local_files: local.files.len() as u32,
        truncated: local.truncated,
        ..SyncPreview::default()
    };
    for (rel, st) in &local.files {
        let lm = st.mtime_secs();
        let item = |remote_mtime| PlanItem {
            rel: rel.clone(),
            size: st.size,
            local_mtime: lm,
            remote_mtime,
        };
        let Some(r) = remote.get(rel) else {
            p.upload_bytes += st.size;
            p.to_upload.push(item(None));
            continue;
        };
        match r.mtime {
            Some(rm) if r.size == st.size && lm.abs_diff(rm) <= SAME_SECS => p.same += 1,
            Some(rm) if lm > rm => {
                p.upload_bytes += st.size;
                p.to_upload.push(item(Some(rm)));
            }
            // Más nuevo en el servidor, o sin fecha para comparar: preguntar.
            other => p.remote_newer.push(item(other)),
        }
    }
    p
}

/// ¿Se pueden aplicar estos borrados en el servidor? Un montón de golpe suele ser un error
/// (carpeta renombrada, disco desconectado): mejor avisar que borrar.
pub fn deletes_allowed(removed: usize) -> bool {
    removed <= MAX_DELETES
}

/// Ruta remota de `rel` dentro de `base` (rutas con `/`).
pub fn remote_path(base: &str, rel: &str) -> String {
    let b = base.trim_end_matches('/');
    if b.is_empty() {
        format!("/{rel}")
    } else {
        format!("{b}/{rel}")
    }
}

/// ¿`rel` es una ruta relativa sin trucos (`..`, absolutas)? Protege los borrados remotos.
pub fn safe_rel(rel: &str) -> bool {
    !rel.is_empty() && !rel.starts_with('/') && rel.split('/').all(|p| !p.is_empty() && p != "." && p != "..")
}

#[cfg(test)]
mod tests {
    use super::super::snapshot::Stamp;
    use super::*;

    fn local(items: &[(&str, u64, u64)]) -> Snapshot {
        Snapshot {
            files: items
                .iter()
                .map(|(r, s, secs)| (r.to_string(), Stamp { size: *s, mtime_ms: secs * 1000 + 500 }))
                .collect(),
            truncated: false,
        }
    }

    #[test]
    fn compare_sorts_files_into_buckets() {
        let l = local(&[("nuevo", 10, 100), ("igual", 5, 100), ("pc-mas-nuevo", 7, 200), ("srv-mas-nuevo", 3, 100), ("sin-fecha", 1, 1)]);
        let r: HashMap<String, RemoteStamp> = [
            ("igual", RemoteStamp { size: 5, mtime: Some(101) }),
            ("pc-mas-nuevo", RemoteStamp { size: 9, mtime: Some(150) }),
            ("srv-mas-nuevo", RemoteStamp { size: 3, mtime: Some(300) }),
            ("sin-fecha", RemoteStamp { size: 2, mtime: None }),
            ("solo-servidor", RemoteStamp { size: 1, mtime: Some(1) }),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
        let p = compare(&l, &r);
        let names = |v: &Vec<PlanItem>| v.iter().map(|i| i.rel.clone()).collect::<Vec<_>>();
        assert_eq!(names(&p.to_upload), vec!["nuevo", "pc-mas-nuevo"]);
        assert_eq!(p.upload_bytes, 17);
        assert_eq!(names(&p.remote_newer), vec!["sin-fecha", "srv-mas-nuevo"]);
        assert_eq!(p.same, 1);
        assert_eq!(p.local_files, 5);
        assert_eq!(p.to_upload[1].remote_mtime, Some(150));
    }

    #[test]
    fn same_size_but_older_on_server_is_uploaded() {
        let l = local(&[("a", 5, 500)]);
        let r = HashMap::from([("a".to_string(), RemoteStamp { size: 5, mtime: Some(100) })]);
        assert_eq!(compare(&l, &r).to_upload.len(), 1);
    }

    #[test]
    fn deletes_and_paths() {
        assert!(deletes_allowed(MAX_DELETES));
        assert!(!deletes_allowed(MAX_DELETES + 1));
        assert_eq!(remote_path("/var/www/", "a/b.html"), "/var/www/a/b.html");
        assert_eq!(remote_path("/", "a"), "/a");
        assert!(safe_rel("a/b.txt"));
        assert!(!safe_rel("../etc/passwd"));
        assert!(!safe_rel("a//b"));
        assert!(!safe_rel("/a"));
        assert!(!safe_rel(""));
    }
}
