//! Direcciones de vuelta al cliente (funciones puras).
//!
//! Solo se vuelve a un programa de este equipo: `http://127.0.0.1`, `http://[::1]` o `http://localhost`
//! (RFC 8252, apps nativas). Y solo a una dirección que el cliente registró: misma máquina, misma ruta y
//! misma consulta; el puerto puede cambiar en cada intento (RFC 8252 §7.3: el cliente abre un puerto libre).

use reqwest::Url;

const LOOPBACK_HOSTS: [&str; 3] = ["127.0.0.1", "[::1]", "localhost"];

/// La dirección, si es de vuelta a este equipo y sin trucos (sin usuario, sin fragmento).
pub fn loopback(uri: &str) -> Option<Url> {
    let u = Url::parse(uri).ok()?;
    let host = u.host_str()?.to_ascii_lowercase();
    let ok = u.scheme() == "http"
        && LOOPBACK_HOSTS.contains(&host.as_str())
        && u.username().is_empty()
        && u.password().is_none()
        && u.fragment().is_none();
    ok.then_some(u)
}

/// `requested` coincide con una de las registradas (salvo el puerto).
pub fn allowed(requested: &str, registered: &[String]) -> bool {
    let Some(req) = loopback(requested) else { return false };
    registered.iter().filter_map(|r| loopback(r)).any(|r| {
        r.host_str().map(str::to_ascii_lowercase) == req.host_str().map(str::to_ascii_lowercase)
            && r.path() == req.path()
            && r.query() == req.query()
    })
}

/// La dirección con estos parámetros añadidos a su consulta (codificados).
pub fn with_params(uri: &str, params: &[(&str, &str)]) -> String {
    match Url::parse(uri) {
        Ok(mut u) => {
            {
                let mut q = u.query_pairs_mut();
                for (k, v) in params {
                    q.append_pair(k, v);
                }
            }
            u.to_string()
        }
        Err(_) => uri.to_string(),
    }
}
