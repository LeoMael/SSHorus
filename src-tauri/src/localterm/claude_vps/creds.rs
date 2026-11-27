//! La cuenta de Claude Code del PC: leer y comprobar `.credentials.json` («Copiar mi sesión») y la llave
//! de `claude setup-token` («Llave de acceso»). Ningún mensaje de error lleva valores.

use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{AppError, AppResult};

/// La única clave de `.credentials.json` que viaja. Las demás (p. ej. `mcpOAuth`, con los tokens de los
/// servidores MCP del PC) se quedan en el PC.
pub const OAUTH_KEY: &str = "claudeAiOauth";
/// Un `.credentials.json` real ocupa unos cientos de bytes: más que esto no es el archivo esperado.
const MAX_CREDS_BYTES: u64 = 256 * 1024;

const NO_FILE: &str = "No se encontró tu sesión de Claude Code en este equipo (~/.claude/.credentials.json). \
     Inicia sesión con «claude» en una terminal local o usa «Llave de acceso». En macOS la sesión está en el \
     Llavero: usa «Llave de acceso».";

/// Dónde guarda Claude Code la sesión en este equipo: `$CLAUDE_CONFIG_DIR/.credentials.json` o
/// `~/.claude/.credentials.json`.
pub fn local_creds_path() -> AppResult<PathBuf> {
    let dir = match std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        Some(d) => PathBuf::from(d),
        None => dirs::home_dir()
            .ok_or_else(|| AppError::NotFound("la carpeta personal de este equipo".into()))?
            .join(".claude"),
    };
    Ok(dir.join(".credentials.json"))
}

/// Lee `path` y devuelve solo `{"claudeAiOauth": …}`, listo para enviar. Todo lo leído se borra de
/// memoria al soltarlo.
pub fn read_oauth(path: &Path) -> AppResult<Zeroizing<Vec<u8>>> {
    let meta = std::fs::metadata(path).map_err(|_| AppError::NotFound(NO_FILE.into()))?;
    if !meta.is_file() || meta.len() > MAX_CREDS_BYTES {
        return Err(AppError::Invalid("~/.claude/.credentials.json no tiene la forma esperada".into()));
    }
    let raw = Zeroizing::new(std::fs::read(path).map_err(|_| AppError::NotFound(NO_FILE.into()))?);
    oauth_only(&raw).map_err(|e| AppError::Invalid(e.into()))
}

/// Comprueba la forma `{"claudeAiOauth":{"accessToken":…,"refreshToken":…}}` y devuelve solo esa
/// clave. El error es un texto fijo (nunca un valor del archivo).
pub fn oauth_only(raw: &[u8]) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    let mut doc: Value = serde_json::from_slice(raw).map_err(|_| "Tu sesión de Claude Code (.credentials.json) no es un JSON válido")?;
    let result = take_oauth(&mut doc);
    wipe_value(&mut doc);
    let mut oauth = result?;
    let ok = ["accessToken", "refreshToken"]
        .iter()
        .all(|k| oauth.get(*k).and_then(Value::as_str).is_some_and(|s| !s.is_empty()));
    let out = if ok {
        let mut top = Map::new();
        top.insert(OAUTH_KEY.into(), std::mem::take(&mut oauth));
        let mut wrapped = Value::Object(top);
        let bytes = serde_json::to_vec(&wrapped).map(Zeroizing::new).map_err(|_| "No se pudo preparar tu sesión de Claude Code");
        wipe_value(&mut wrapped);
        bytes
    } else {
        Err("A tu sesión de Claude Code le falta el accessToken o el refreshToken: vuelve a iniciar sesión con «claude» en este equipo")
    };
    wipe_value(&mut oauth);
    out
}

fn take_oauth(doc: &mut Value) -> Result<Value, &'static str> {
    match doc.as_object_mut().and_then(|o| o.remove(OAUTH_KEY)) {
        Some(v @ Value::Object(_)) => Ok(v),
        Some(mut other) => {
            wipe_value(&mut other);
            Err("Tu sesión de Claude Code no tiene la forma esperada")
        }
        None => Err("Tu sesión de Claude Code no tiene la sección claudeAiOauth (¿iniciaste sesión con una cuenta de claude.ai?)"),
    }
}

/// Pisa con ceros los textos de un JSON (los valores; los nombres de las claves no son secretos).
fn wipe_value(v: &mut Value) {
    match v {
        Value::String(s) => s.zeroize(),
        Value::Array(a) => a.iter_mut().for_each(wipe_value),
        Value::Object(o) => o.values_mut().for_each(wipe_value),
        _ => {}
    }
}

/// Caracteres de la llave después del prefijo (unos 100; menos de esto es un trozo).
const TOKEN_MIN_BODY: usize = 80;

/// La forma de la llave de `claude setup-token`: `sk-ant-oat` + dos cifras + `-` + el cuerpo.
fn is_token(t: &str) -> bool {
    let Some(rest) = t.strip_prefix("sk-ant-oat") else { return false };
    let b = rest.as_bytes();
    b.len() >= 3 + TOKEN_MIN_BODY
        && b[..2].iter().all(u8::is_ascii_digit)
        && b[2] == b'-'
        && b[3..].iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-' || *c == b'_')
}

/// Quita los espacios y saltos de línea (la terminal parte la llave en varias líneas al copiarla) y
/// comprueba su forma.
pub fn normalize_token(pasted: &str) -> AppResult<Zeroizing<String>> {
    // Con la capacidad reservada de antemano: al crecer, `String` dejaría copias de la llave sin borrar.
    let mut token = Zeroizing::new(String::with_capacity(pasted.len()));
    token.extend(pasted.chars().filter(|c| !c.is_whitespace()));
    if is_token(&token) {
        Ok(token)
    } else {
        Err(AppError::Invalid(
            "Eso no parece una llave de «claude setup-token»: empieza por sk-ant-oat01- y es muy larga (unos 100 caracteres)".into(),
        ))
    }
}
