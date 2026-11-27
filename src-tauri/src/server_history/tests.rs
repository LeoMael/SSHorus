use std::path::PathBuf;

use super::model::{EventSource, HistoryEvent};
use super::redact::{redact_event, redact_text};
use super::store::{HistoryStore, ROTATE_BYTES};

fn tmp() -> PathBuf {
    std::env::temp_dir().join(format!("sshorus-history-test-{}", uuid::Uuid::new_v4()))
}

fn ev(title: &str) -> HistoryEvent {
    HistoryEvent {
        id: String::new(),
        at: 0,
        source: EventSource::Terminal,
        title: title.into(),
        detail: String::new(),
        ok: None,
        result: String::new(),
        server_name: "web".into(),
    }
}

#[test]
fn guarda_y_lista_lo_mas_nuevo_primero() {
    let dir = tmp();
    let s = HistoryStore::at(&dir);
    let a = s.append("srv-1", ev("ls -la")).unwrap();
    s.append("srv-1", ev("uptime")).unwrap();
    s.append("otro", ev("df -h")).unwrap();
    assert!(!a.id.is_empty() && a.at > 0);
    let l = s.list("srv-1").unwrap();
    assert_eq!(l.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["uptime", "ls -la"]);
    s.clear("srv-1").unwrap();
    assert!(s.list("srv-1").unwrap().is_empty());
    assert_eq!(s.list("otro").unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn rechaza_ids_raros_y_entradas_vacias() {
    let s = HistoryStore::at(tmp());
    assert!(s.append("../x", ev("ls")).is_err());
    assert!(s.list("a/b").is_err());
    assert!(s.append("srv", ev("   ")).is_err());
}

#[test]
fn rota_al_crecer_y_conserva_las_dos_partes() {
    let dir = tmp();
    let s = HistoryStore::at(&dir);
    let mut big = ev("grande");
    big.detail = "x".repeat(3900);
    let n = (ROTATE_BYTES / 3900) as usize + 2;
    for _ in 0..n {
        s.append("srv", big.clone()).unwrap();
    }
    s.append("srv", ev("última")).unwrap();
    assert!(dir.join("srv.1.jsonl").exists());
    let l = s.list("srv").unwrap();
    assert_eq!(l[0].title, "última");
    assert_eq!(l.len(), n + 1);
    // Con otra rotación, la parte más vieja se pierde: nunca pasa de ~2 × ROTATE_BYTES.
    for _ in 0..n {
        s.append("srv", big.clone()).unwrap();
    }
    let size: u64 = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()?.metadata().ok()).map(|m| m.len()).sum();
    assert!(size < 2 * ROTATE_BYTES + 8192, "{size}");
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn tapa_contraseñas_y_llaves() {
    let cases = [
        ("mysql -u root -pS3cret! mydb", "mysql -u root -p•••• mydb"),
        ("mysqldump --user=app -p'a b' db", "mysqldump --user=app -p•••• db"),
        ("sshpass -p hunter2 ssh x", "sshpass -p •••• ssh x"),
        ("psql --password=abc host", "psql --password=•••• host"),
        ("export DB_PASSWORD=abc123", "export DB_PASSWORD=••••"),
        ("curl -H 'Authorization: Bearer abcdefgh12345' x", "curl -H 'Authorization: Bearer ••••' x"),
        ("git clone https://ana:tok3n@github.com/x.git", "git clone https://ana:••••@github.com/x.git"),
        ("echo 'mi clave' | sudo -S apt update", "echo •••• | sudo -S apt update"),
        ("gh auth login --with-token ghp_AbC123xyz", "gh auth login --with-token ••••"),
        ("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-zz claude", "CLAUDE_CODE_OAUTH_TOKEN=•••• claude"),
        ("aws AKIAABCDEFGHIJKLMNOP", "aws ••••"),
    ];
    for (input, want) in cases {
        assert_eq!(redact_text(input, &[]), want, "{input}");
    }
}

#[test]
fn no_tapa_comandos_normales() {
    for t in ["ls -la /etc", "mkdir -p /srv/app", "pwd", "sudo systemctl restart nginx", "cat /etc/passwd", "basic auth"] {
        assert_eq!(redact_text(t, &[]), t);
    }
    // Un aviso de contraseña en la salida no se come la línea siguiente.
    assert_eq!(redact_text("Password:\nSorry, try again.", &[]), "Password:\nSorry, try again.");
}

#[test]
fn tapa_las_contraseñas_guardadas_largas() {
    let mut e = ev("su -c 'echo superclave99'");
    e.result = "superclave99 admin".into();
    redact_event(&mut e, &["superclave99", "admin"]);
    assert_eq!(e.title, "su -c 'echo ••••'");
    // Las cortas no (taparlas en cualquier texto diría cuál es).
    assert_eq!(e.result, "•••• admin");
}

#[test]
fn lee_del_registro_del_asistente_solo_ese_servidor() {
    use crate::mcp::audit::{AuditEntry, AuditLog, AuditStatus};
    let dir = tmp();
    std::fs::create_dir_all(&dir).unwrap();
    let log = AuditLog::at(Some(dir.join("mcp-audit.jsonl")));
    let rows = [("a", AuditStatus::Ok, "uptime"), ("b", AuditStatus::Ok, "df"), ("a", AuditStatus::Running, "top"), ("a", AuditStatus::Error, "ls /x")];
    for (srv, status, detail) in rows {
        let mut e = AuditEntry::start("run_command");
        e.server_id = Some(srv.into());
        e.status = status;
        e.detail = detail.into();
        log.record(e);
    }
    let got: Vec<String> = log.for_server("a", 10).into_iter().map(|e| e.detail).collect();
    assert_eq!(got, ["ls /x", "uptime"]);
    assert_eq!(log.for_server("a", 1).len(), 1);
    let _ = std::fs::remove_dir_all(dir);
}
