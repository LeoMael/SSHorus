//! Foto de la carpeta del PC (tamaño y fecha de cada archivo) y diferencias entre dos fotos.
//!
//! Sin dependencias nuevas: se recorre con `walkdir` cada poco (ver `runner`). Los enlaces
//! simbólicos no se siguen ni se suben.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::UNIX_EPOCH;

use walkdir::WalkDir;

use super::filter::{parse_ignore_file, IgnoreRules, IGNORE_FILE};

/// Más archivos que esto y se vigilan solo los primeros (con aviso).
pub const MAX_FILES: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Stamp {
    pub size: u64,
    /// Unix ms (para notar cambios aunque sean en el mismo segundo).
    pub mtime_ms: u64,
}

impl Stamp {
    pub fn mtime_secs(&self) -> u64 {
        self.mtime_ms / 1000
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    /// Ruta relativa con `/` → sello.
    pub files: BTreeMap<String, Stamp>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Changes {
    /// Nuevos o modificados.
    pub changed: Vec<String>,
    pub removed: Vec<String>,
}

impl Changes {
    pub fn is_empty(&self) -> bool {
        self.changed.is_empty() && self.removed.is_empty()
    }
}

/// Patrones del diálogo más los de `<root>/.sshorusignore` (si existe).
pub fn rules_for(root: &Path, extra: &[String]) -> IgnoreRules {
    let mut all: Vec<String> = extra.to_vec();
    if let Ok(text) = std::fs::read_to_string(root.join(IGNORE_FILE)) {
        all.extend(parse_ignore_file(&text));
    }
    IgnoreRules::new(&all)
}

/// Recorre `root` (bloqueante: llamar desde `spawn_blocking`). Error si la carpeta no se puede leer.
pub fn scan(root: &Path, rules: &IgnoreRules, limit: usize) -> Result<Snapshot, String> {
    let meta = std::fs::metadata(root).map_err(|e| format!("No se puede leer la carpeta de tu PC: {e}"))?;
    if !meta.is_dir() {
        return Err("La carpeta de tu PC ya no existe".into());
    }
    let mut snap = Snapshot::default();
    let walker = WalkDir::new(root).follow_links(false).sort_by_file_name().into_iter().filter_entry(|e| {
        if e.depth() == 0 {
            return true;
        }
        match rel_of(root, e.path()) {
            Some(rel) => !rules.is_ignored(&rel, e.file_type().is_dir()),
            None => false,
        }
    });
    for entry in walker {
        // Lo ilegible (permisos, borrado a mitad) se salta: la próxima vuelta lo verá.
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(rel) = rel_of(root, entry.path()) else { continue };
        let Ok(m) = entry.metadata() else { continue };
        if snap.files.len() >= limit {
            snap.truncated = true;
            break;
        }
        let mtime_ms = m
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        snap.files.insert(rel, Stamp { size: m.len(), mtime_ms });
    }
    Ok(snap)
}

fn rel_of(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Option<Vec<&str>> = rel.components().map(|c| c.as_os_str().to_str()).collect();
    let joined = parts?.join("/");
    (!joined.is_empty()).then_some(joined)
}

/// Qué cambió de `old` a `new`.
pub fn diff(old: &Snapshot, new: &Snapshot) -> Changes {
    let mut c = Changes::default();
    for (rel, stamp) in &new.files {
        if old.files.get(rel) != Some(stamp) {
            c.changed.push(rel.clone());
        }
    }
    // Si la foto nueva está recortada, lo que falta puede estar fuera del límite: no es un borrado.
    if !new.truncated {
        for rel in old.files.keys() {
            if !new.files.contains_key(rel) {
                c.removed.push(rel.clone());
            }
        }
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snap(items: &[(&str, u64, u64)]) -> Snapshot {
        Snapshot {
            files: items.iter().map(|(r, s, m)| (r.to_string(), Stamp { size: *s, mtime_ms: *m })).collect(),
            truncated: false,
        }
    }

    #[test]
    fn diff_finds_new_changed_and_removed() {
        let old = snap(&[("a", 1, 10), ("b", 2, 20), ("c", 3, 30)]);
        let new = snap(&[("a", 1, 10), ("b", 2, 21), ("d", 4, 40)]);
        let c = diff(&old, &new);
        assert_eq!(c.changed, vec!["b", "d"]);
        assert_eq!(c.removed, vec!["c"]);
        assert!(diff(&new, &new).is_empty());
    }

    #[test]
    fn truncated_snapshot_never_reports_removals() {
        let old = snap(&[("a", 1, 10), ("b", 2, 20)]);
        let mut new = snap(&[("a", 1, 10)]);
        new.truncated = true;
        assert!(diff(&old, &new).removed.is_empty());
    }

    #[test]
    fn scan_skips_ignored_and_respects_limit() {
        let root = std::env::temp_dir().join(format!("sshorus-sync-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src/node_modules/x")).unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::create_dir_all(root.join("dist")).unwrap();
        std::fs::write(root.join("index.html"), "hola").unwrap();
        std::fs::write(root.join("src/app.js"), "x").unwrap();
        std::fs::write(root.join("src/.app.js.swp"), "x").unwrap();
        std::fs::write(root.join("src/node_modules/x/m.js"), "x").unwrap();
        std::fs::write(root.join(".git/HEAD"), "x").unwrap();
        std::fs::write(root.join("dist/out.js"), "x").unwrap();
        std::fs::write(root.join(IGNORE_FILE), "dist/\n").unwrap();

        let rules = rules_for(&root, &[]);
        let s = scan(&root, &rules, MAX_FILES).unwrap();
        let names: Vec<&str> = s.files.keys().map(String::as_str).collect();
        assert_eq!(names, vec!["index.html", "src/app.js"]);
        assert_eq!(s.files["index.html"].size, 4);
        assert!(!s.truncated);

        let small = scan(&root, &rules, 1).unwrap();
        assert_eq!(small.files.len(), 1);
        assert!(small.truncated);

        std::fs::remove_dir_all(&root).unwrap();
        assert!(scan(&root, &rules, MAX_FILES).is_err());
    }
}
