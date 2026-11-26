use super::chat::{ChatMessage, ChatReq};
use super::http::{endpoint, is_temperature_rejected};
use super::*;

#[test]
fn base_url_rules() {
    assert!(check_base_url("https://api.openai.com/v1").is_ok());
    assert!(check_base_url("http://localhost:11434/v1").is_ok());
    assert!(check_base_url("http://127.0.0.1:8080/v1/").is_ok());
    assert!(check_base_url("http://example.com/v1").is_err());
    assert!(check_base_url("ftp://example.com").is_err());
    assert!(check_base_url("https://user:pw@example.com/v1").is_err());
    assert!(check_base_url("https://example.com/v1?x=1").is_err());
    assert!(check_base_url("").is_err());
    let u = check_base_url("https://api.openai.com/v1/").unwrap();
    assert_eq!(endpoint(&u, "chat/completions").unwrap().as_str(), "https://api.openai.com/v1/chat/completions");
}

#[test]
fn settings_default_off() {
    let s = AiSettings::default();
    assert!(!s.enabled);
    let s = AiSettings { enabled: true, base_url: " https://x.y/v1/ ".into(), model: " m ".into() }.sanitized();
    assert_eq!(s.base_url, "https://x.y/v1");
    assert_eq!(s.model, "m");
}

#[test]
fn chat_req_omits_temperature_when_none() {
    let msgs = [ChatMessage { role: "user".into(), content: "hola".into() }];
    let with = serde_json::to_value(ChatReq { model: "claude", messages: &msgs, temperature: Some(0.2) }).unwrap();
    assert!(with.get("temperature").is_some());
    let without = serde_json::to_value(ChatReq { model: "claude", messages: &msgs, temperature: None }).unwrap();
    assert!(without.get("temperature").is_none());
}

#[test]
fn detects_temperature_rejection() {
    let bad_req = reqwest::StatusCode::BAD_REQUEST;
    let unproc = reqwest::StatusCode::UNPROCESSABLE_ENTITY;
    let claude = br#"{"error":{"type":"invalid_request_error","message":"`temperature` may not be set when thinking is enabled"}}"#;
    let openai = br#"{"error":{"message":"Unsupported parameter: 'temperature' is not supported with this model."}}"#;
    let other = br#"{"error":{"message":"model not found"}}"#;
    assert!(is_temperature_rejected(bad_req, claude));
    assert!(is_temperature_rejected(unproc, openai));
    assert!(!is_temperature_rejected(bad_req, other));
    assert!(!is_temperature_rejected(reqwest::StatusCode::UNAUTHORIZED, claude));
}
