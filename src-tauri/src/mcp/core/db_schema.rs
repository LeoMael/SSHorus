//! `get_db_schema`: esquema (solo lectura) de las bases de datos del servidor.
//!
//! Lo hace la interfaz (`features/databases/mcp.ts`), con los mismos scripts y analizadores que la pestaña
//! «Bases de datos»: busca las bases (PostgreSQL, MySQL/MariaDB, en el servidor o en contenedores) y lee su
//! esquema con la credencial guardada en SSHorus o sin contraseña (socket local o contenedor), siempre como
//! el usuario conectado y sin sudo, igual que `list_ports`. Las contraseñas nunca pasan por aquí: la
//! interfaz las lee de la bóveda o el llavero y las da por stdin al comando remoto; el asistente solo recibe
//! el esquema.

use std::time::Duration;

use rmcp::schemars::{self, JsonSchema};
use serde::Deserialize;
use serde_json::json;

use super::super::backend::Backend;
use super::super::policy::Action;
use super::output::clip_middle;
use super::{Fail, McpCore, Rec, Res, MAX_SCAN_BYTES};

/// Tiempo de espera de la interfaz (un esquema grande puede tardar en un VPS pequeño).
const UI_DB_TIMEOUT: Duration = Duration::from_secs(150);
/// Largo máximo de cada texto (nombres de bases, esquemas, tablas, rutas, destinos).
const MAX_FIELD: usize = 300;

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DbSchemaParams {
    /// Nombre o id del servidor (ver list_servers). Hace falta una conexión abierta (connect).
    pub server: String,
    /// Conexión concreta (ver list_sessions). Si no se da, se usa la más reciente de ese servidor.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Qué base de datos leer: el `key` de un destino de la lista (p. ej. «pg@127.0.0.1:5432» o
    /// «mysql@ctr:root/tienda-db»). Sin él, devuelve los destinos encontrados.
    #[serde(default)]
    pub target: Option<String>,
    /// Ruta de un archivo SQLite del servidor (en lugar de `target`). No se busca por el disco.
    #[serde(default)]
    pub sqlite_path: Option<String>,
    /// Base de datos dentro de ese destino. Sin ella, devuelve la lista de bases con su tamaño.
    #[serde(default)]
    pub database: Option<String>,
    /// Solo este esquema (PostgreSQL; en MySQL el esquema es la base).
    #[serde(default)]
    pub schema: Option<String>,
    /// Solo esta tabla (con sus columnas, índices y claves foráneas).
    #[serde(default)]
    pub table: Option<String>,
}

/// Comprueba un texto opcional: sin saltos de línea ni caracteres nulos y de largo razonable.
fn field(name: &str, v: &Option<String>) -> Res<Option<String>> {
    let Some(s) = v.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    if s.len() > MAX_FIELD || s.contains(['\n', '\r', '\0']) {
        return Err(Fail::Error(format!("Parámetros no válidos: «{name}» no puede tener saltos de línea ni pasar de {MAX_FIELD} caracteres")));
    }
    Ok(Some(s.to_string()))
}

/// Qué se pide, para el registro («destinos», «pg@… → tienda»).
fn detail(target: Option<&str>, database: Option<&str>, table: Option<&str>) -> String {
    match (target, database, table) {
        (None, _, _) => "buscar bases de datos".into(),
        (Some(t), None, _) => format!("{t}: lista de bases"),
        (Some(t), Some(d), None) => format!("{t} → {d}"),
        (Some(t), Some(d), Some(x)) => format!("{t} → {d}.{x}"),
    }
}

impl<B: Backend> McpCore<B> {
    pub(super) async fn db_schema(&self, p: DbSchemaParams, rec: &mut Rec) -> Res<String> {
        let sqlite = field("sqlite_path", &p.sqlite_path)?;
        if sqlite.as_deref().is_some_and(|s| !s.starts_with('/')) {
            return Err(Fail::Error("Parámetros no válidos: «sqlite_path» debe ser una ruta absoluta".into()));
        }
        let target = match (&sqlite, field("target", &p.target)?) {
            (Some(_), Some(_)) => {
                return Err(Fail::Error("Parámetros no válidos: usa «target» o «sqlite_path», no los dos".into()));
            }
            (Some(path), None) => Some(format!("sqlite@{path}")),
            (None, t) => t,
        };
        let database = field("database", &p.database)?;
        let schema = field("schema", &p.schema)?;
        let table = field("table", &p.table)?;
        rec.entry.detail = detail(target.as_deref(), database.as_deref(), table.as_deref());

        let t = self.target(&p.server, p.session_id.as_deref(), rec).await?;
        let sid = t.session_id()?.to_string();
        self.authorize(rec, &t, Action::read("get_db_schema"), "", "", None).await?;
        let payload = json!({
            "sessionId": sid,
            "profileId": t.server.id,
            "target": target,
            "database": database,
            "schema": schema,
            "table": table,
        });
        let v = self.backend.ui_request("db-schema", payload, UI_DB_TIMEOUT).await?;
        let text = serde_json::to_string_pretty(&v).unwrap_or_default();
        Ok(clip_middle(&text, MAX_SCAN_BYTES))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_are_trimmed_and_checked() {
        assert_eq!(field("x", &None).unwrap(), None);
        assert_eq!(field("x", &Some("  ".into())).unwrap(), None);
        assert_eq!(field("x", &Some(" tienda ".into())).unwrap().as_deref(), Some("tienda"));
        assert!(field("x", &Some("a\nb".into())).is_err());
        assert!(field("x", &Some("a".repeat(MAX_FIELD + 1))).is_err());
    }

    #[test]
    fn detail_text() {
        assert_eq!(detail(None, None, None), "buscar bases de datos");
        assert_eq!(detail(Some("pg@x"), None, None), "pg@x: lista de bases");
        assert_eq!(detail(Some("pg@x"), Some("app"), Some("users")), "pg@x → app.users");
    }
}
