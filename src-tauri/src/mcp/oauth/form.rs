//! Parámetros de OAuth (consulta de la URL o cuerpo `application/x-www-form-urlencoded`), puro.

use std::collections::HashMap;

use reqwest::Url;

/// Parámetros ya decodificados. Un parámetro repetido hace inválida la petición (RFC 6749 §3.1).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Params(HashMap<String, String>);

impl Params {
    /// None si está mal formado o repite un parámetro.
    pub fn parse(encoded: &str) -> Option<Params> {
        let url = Url::parse(&format!("http://x/?{encoded}")).ok()?;
        let mut map = HashMap::new();
        for (k, v) in url.query_pairs() {
            if map.insert(k.into_owned(), v.into_owned()).is_some() {
                return None;
            }
        }
        Some(Params(map))
    }

    /// El valor, si viene y no está vacío.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).map(String::as_str).filter(|v| !v.is_empty())
    }
}
