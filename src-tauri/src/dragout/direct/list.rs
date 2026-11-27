//! Qué se ofrece al sistema en el arrastre directo: la lista de archivos y carpetas (ruta
//! relativa ya adaptada a Windows, tamaño y fecha), recorriendo por SFTP las carpetas elegidas.
//! Las carpetas van antes que su contenido (el Explorador las crea según llegan).

use std::collections::HashSet;
use std::future::Future;

use russh_sftp::client::SftpSession;
use russh_sftp::protocol::FileAttributes;

use crate::error::{AppError, AppResult};
use crate::transfer::paths::{numbered_name, remote_basename, remote_join, remote_kind, safe_remote_name, windows_safe_name, RemoteKind};

/// Con más elementos se usa el arrastre de siempre (descargar primero).
pub const MAX_ENTRIES: usize = 10_000;
/// Windows guarda la ruta relativa en `cFileName[260]`, con el cero final.
pub const NAME_UNITS: usize = 260;
/// Segundos entre 1601-01-01 (origen de `FILETIME`) y 1970-01-01.
const FILETIME_UNIX_OFFSET: u64 = 11_644_473_600;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VirtualEntry {
    /// Ruta relativa con `\` ("fotos\viaje\a.jpg"), con nombres válidos en Windows.
    pub rel: String,
    /// Ruta en el servidor.
    pub remote: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix segundos.
    pub modified: Option<u64>,
}

/// Un elemento remoto como lo describe el servidor.
#[derive(Debug, Clone)]
pub struct RemoteItem {
    pub name: String,
    pub kind: RemoteKind,
    pub size: u64,
    pub modified: Option<u64>,
}

/// Lo mínimo del servidor para recorrer: SFTP en la app, uno falso en las pruebas.
pub trait RemoteTree: Sync {
    /// Sigue los enlaces.
    fn stat(&self, path: &str) -> impl Future<Output = AppResult<RemoteItem>> + Send;
    /// Contenido de una carpeta, sin seguir los enlaces.
    fn list(&self, path: &str) -> impl Future<Output = AppResult<Vec<RemoteItem>>> + Send;
}

fn item_of(name: String, a: &FileAttributes) -> RemoteItem {
    RemoteItem { name, kind: remote_kind(a.permissions), size: a.size.unwrap_or(0), modified: a.mtime.map(u64::from) }
}

impl RemoteTree for SftpSession {
    fn stat(&self, path: &str) -> impl Future<Output = AppResult<RemoteItem>> + Send {
        let path = path.to_string();
        async move {
            let meta = self.metadata(path.clone()).await?;
            Ok(item_of(remote_basename(&path), &meta))
        }
    }

    fn list(&self, path: &str) -> impl Future<Output = AppResult<Vec<RemoteItem>>> + Send {
        let path = path.to_string();
        async move {
            let dir = self.read_dir(path).await?;
            Ok(dir.map(|e| item_of(e.file_name(), &e.metadata())).collect())
        }
    }
}

/// Recorre `roots` (rutas remotas completas) y devuelve la lista para el sistema.
/// Falla (y la interfaz vuelve al arrastre de siempre) si hay demasiados elementos o una ruta
/// no cabe en `cFileName`. Se omiten los enlaces a carpetas (podrían dar vueltas) y lo que no
/// es archivo ni carpeta.
pub async fn collect<T: RemoteTree>(tree: &T, roots: &[String]) -> AppResult<Vec<VirtualEntry>> {
    let mut list = Listing::default();
    let mut pending: Vec<(String, String)> = Vec::new();
    for root in roots {
        let item = tree.stat(root).await?;
        if let Some(rel) = list.push("", root, &item, item.kind == RemoteKind::Dir)? {
            pending.push((root.clone(), rel));
        }
    }
    while let Some((dir, rel_dir)) = pending.pop() {
        for item in tree.list(&dir).await? {
            if !safe_remote_name(&item.name) {
                continue;
            }
            let remote = remote_join(&dir, &item.name);
            let item = match item.kind {
                RemoteKind::Link => match tree.stat(&remote).await {
                    Ok(t) if t.kind != RemoteKind::Dir => RemoteItem { name: item.name, ..t },
                    _ => continue,
                },
                _ => item,
            };
            if let Some(rel) = list.push(&rel_dir, &remote, &item, item.kind == RemoteKind::Dir)? {
                pending.push((remote, rel));
            }
        }
    }
    Ok(list.entries)
}

#[derive(Default)]
struct Listing {
    entries: Vec<VirtualEntry>,
    /// Rutas relativas ya usadas, en minúsculas (Windows no distingue mayúsculas).
    taken: HashSet<String>,
}

impl Listing {
    /// Añade un elemento dentro de `parent` (relativa, "" en la raíz). Devuelve su ruta relativa si
    /// es una carpeta (para recorrerla).
    fn push(&mut self, parent: &str, remote: &str, item: &RemoteItem, is_dir: bool) -> AppResult<Option<String>> {
        if !is_dir && !matches!(item.kind, RemoteKind::File | RemoteKind::Unknown) {
            return Ok(None);
        }
        if self.entries.len() >= MAX_ENTRIES {
            return Err(AppError::Invalid(format!("Hay más de {MAX_ENTRIES} elementos para arrastrar directo")));
        }
        let base = windows_safe_name(&item.name);
        let rel = (1..)
            .map(|n| if n == 1 { base.clone() } else { numbered_name(&base, n) })
            .map(|name| if parent.is_empty() { name } else { format!("{parent}\\{name}") })
            .find(|rel| !self.taken.contains(&rel.to_lowercase()))
            .unwrap_or_default();
        if rel.encode_utf16().count() >= NAME_UNITS {
            return Err(AppError::Invalid(format!("La ruta «{rel}» es demasiado larga para arrastrar directo")));
        }
        self.taken.insert(rel.to_lowercase());
        self.entries.push(VirtualEntry {
            rel: rel.clone(),
            remote: remote.to_string(),
            is_dir,
            size: if is_dir { 0 } else { item.size },
            modified: item.modified,
        });
        Ok(is_dir.then_some(rel))
    }
}

/// Nombre relativo en UTF-16 con el cero final, como lo guarda `FILEDESCRIPTORW`.
/// `None` si no cabe.
pub fn wide_name(rel: &str) -> Option<[u16; NAME_UNITS]> {
    let units: Vec<u16> = rel.encode_utf16().collect();
    if units.len() >= NAME_UNITS {
        return None;
    }
    let mut out = [0u16; NAME_UNITS];
    out[..units.len()].copy_from_slice(&units);
    Some(out)
}

/// Unix segundos → `FILETIME` (intervalos de 100 ns desde 1601).
pub fn unix_to_filetime(secs: u64) -> u64 {
    secs.saturating_add(FILETIME_UNIX_OFFSET).saturating_mul(10_000_000)
}
