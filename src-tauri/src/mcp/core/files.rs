//! Archivos del servidor: listar, leer, guardar (con diff), subir y descargar.

use serde_json::{json, Value};

use super::super::backend::Backend;
use super::super::diff;
use super::super::grants::Need;
use super::super::policy::Action;
use super::output::{bullet, pretty};
use super::{
    DownloadParams, Fail, ListDirParams, McpCore, PathParams, ReadFileParams, Rec, Res, UploadParams, WriteFileParams,
    DEFAULT_READ_BYTES, MAX_DIR_ENTRIES, MAX_READ_BYTES, MAX_WRITE_BYTES,
};
use crate::error::AppError;
use crate::types::{FileEntry, FileKind};

impl<B: Backend> McpCore<B> {
    pub(super) async fn list_dir(&self, p: ListDirParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = p.path.clone();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.authorize(rec, &t, Action::read("list_dir"), "", "", None).await?;
        let path = if p.path.trim().is_empty() { "." } else { p.path.as_str() };
        let entries = self.backend.list_dir(&sid, path).await?;
        let total = entries.len();
        let rows: Vec<Value> = entries.iter().take(MAX_DIR_ENTRIES).map(entry_json).collect();
        let mut out = pretty(&rows);
        if total > MAX_DIR_ENTRIES {
            out.push_str(&format!("\n(se muestran {MAX_DIR_ENTRIES} de {total} entradas)"));
        }
        rec.entry.message = Some(format!("{total} entradas"));
        Ok(out)
    }

    pub(super) async fn stat(&self, p: PathParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = p.path.clone();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.authorize(rec, &t, Action::read("stat"), "", "", None).await?;
        let e = self.backend.stat(&sid, &p.path).await?;
        Ok(pretty(&entry_json(&e)))
    }

    pub(super) async fn read_file(&self, p: ReadFileParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = p.path.clone();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.authorize(rec, &t, Action::read("read_file"), "", "", None).await?;
        let offset = p.offset.unwrap_or(0);
        let max = p.max_bytes.unwrap_or(DEFAULT_READ_BYTES).clamp(1, MAX_READ_BYTES);
        let part = self.backend.read_part(&sid, &p.path, offset, max).await?;
        let probe = &part.data[..part.data.len().min(8192)];
        if probe.contains(&0) {
            return Ok(format!(
                "«{}» es un archivo binario ({} bytes): no se muestra. Usa download para bajarlo.",
                part.path, part.size
            ));
        }
        let end = part.offset + part.data.len() as u64;
        let mut out = format!("Archivo {} ({} bytes en total).", part.path, part.size);
        if part.offset > 0 || end < part.size {
            out.push_str(&format!(" Se muestran los bytes {}–{}.", part.offset, end));
        }
        out.push('\n');
        out.push_str(&String::from_utf8_lossy(&part.data));
        if end < part.size {
            out.push_str(&format!("\n[Quedan {} bytes: vuelve a llamar con offset={end}.]", part.size - end));
        }
        rec.entry.message = Some(format!("{} bytes leídos", part.data.len()));
        Ok(out)
    }

    pub(super) async fn write_file(&self, p: WriteFileParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = p.path.clone();
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        if p.content.len() > MAX_WRITE_BYTES {
            return Err(Fail::Error(format!("El contenido pasa de {} bytes.", MAX_WRITE_BYTES)));
        }
        if p.path.trim().is_empty() {
            return Err(Fail::Error("Falta la ruta.".into()));
        }
        let sid = t.session_id()?.to_string();
        // El permiso se comprueba antes de leer nada (en solo lectura no hace falta el diff).
        let key = format!("write_file\n{}", p.path.trim());
        let path = vec![p.path.trim().to_string()];
        self.precheck(&t, Action::change(key.clone()).with_need(Need::Write { paths: path.clone(), outside: vec![] }))?;
        let action = Action::change(key).with_need(self.write_need(&t, &sid, &path).await?);
        self.precheck(&t, action.clone())?;
        let diff = match self.backend.read_part(&sid, &p.path, 0, MAX_WRITE_BYTES as u64 + 1).await {
            Ok(old) if old.size as usize > MAX_WRITE_BYTES || old.data.contains(&0) => {
                format!("(el archivo actual ocupa {} bytes y no se puede comparar; se reemplazará entero)", old.size)
            }
            Ok(old) => {
                let old = String::from_utf8_lossy(&old.data);
                let d = diff::unified(&old, &p.content);
                if d.is_empty() && old != p.content {
                    "(solo cambian los saltos de línea del final)".into()
                } else if d.is_empty() {
                    "(sin cambios)".into()
                } else {
                    d
                }
            }
            Err(AppError::NotFound(_)) => {
                let d = diff::unified("", &p.content);
                format!("(archivo nuevo)\n{d}")
            }
            Err(e) => return Err(e.into()),
        };
        let shown = format!("{} ({} bytes)", p.path.trim(), p.content.len());
        self.authorize(rec, &t, action, "quiere guardar un archivo", &shown, Some(diff)).await?;
        let saved = self.backend.write_text(&sid, &p.path, &p.content).await?;
        rec.entry.message = Some(format!("{} bytes guardados", saved.size));
        Ok(format!("Guardado {} ({} bytes).", saved.path, saved.size))
    }

    pub(super) async fn upload(&self, p: UploadParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = format!("{} → {}", p.local_paths.join(", "), p.remote_dir);
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        if p.local_paths.is_empty() {
            return Err(Fail::Error("No hay nada que subir.".into()));
        }
        for lp in &p.local_paths {
            let path = std::path::Path::new(lp);
            if !path.is_absolute() || !path.exists() {
                return Err(Fail::Error(format!("No existe en este PC (usa rutas absolutas): {lp}")));
            }
        }
        if p.remote_dir.trim().is_empty() {
            return Err(Fail::Error("Falta la carpeta de destino.".into()));
        }
        let shown = format!("Subir a {}:\n{}", p.remote_dir, bullet(&p.local_paths));
        let key = format!("upload\n{}\n{}", p.remote_dir, p.local_paths.join("\n"));
        let dir = vec![p.remote_dir.trim().to_string()];
        self.precheck(&t, Action::change(key.clone()).with_need(Need::Write { paths: dir.clone(), outside: vec![] }))?;
        let action = Action::change(key).with_need(self.write_need(&t, &sid, &dir).await?);
        self.authorize(rec, &t, action, "quiere subir archivos al servidor", &shown, None).await?;
        let batch = self.backend.upload(&sid, p.local_paths, p.remote_dir).await?;
        Ok(format!("Subida en cola (lote {batch}). Mira el progreso con transfer_status."))
    }

    pub(super) async fn download(&self, p: DownloadParams, rec: &mut Rec) -> Res<String> {
        rec.entry.detail = format!("{} → {}", p.remote_paths.join(", "), p.local_dir);
        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        if p.remote_paths.is_empty() {
            return Err(Fail::Error("No hay nada que descargar.".into()));
        }
        let dir = std::path::Path::new(&p.local_dir);
        if !dir.is_absolute() || !dir.is_dir() {
            return Err(Fail::Error(format!("La carpeta local no existe (usa una ruta absoluta): {}", p.local_dir)));
        }
        let shown = format!("Descargar a {} (este PC):\n{}", p.local_dir, bullet(&p.remote_paths));
        let key = format!("download\n{}\n{}", p.local_dir, p.remote_paths.join("\n"));
        self.authorize(rec, &t, Action::change_on_read(key), "quiere descargar archivos a tu PC", &shown, None)
            .await?;
        let batch = self.backend.download(&sid, p.remote_paths, p.local_dir).await?;
        Ok(format!("Descarga en cola (lote {batch}). Mira el progreso con transfer_status."))
    }
}

fn entry_json(e: &FileEntry) -> Value {
    json!({
        "name": e.name,
        "path": e.path,
        "kind": match e.kind {
            FileKind::File => "file",
            FileKind::Dir => "dir",
            FileKind::Symlink => if e.is_dir_link { "symlink-dir" } else { "symlink" },
            FileKind::Other => "other",
        },
        "size": e.size,
        "modified": e.modified,
        "permissions": e.permissions_str,
    })
}
