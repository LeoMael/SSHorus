//! Pruebas del diálogo con el programa (`drive`) con un terminal de mentira.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use super::*;
use crate::mcp::redact::MASK;

const PW: &str = "s3cr3t-pass";

/// Terminal de mentira: suelta `queue`; cada escritura suelta el siguiente grupo de `after_write`.
#[derive(Default)]
pub(crate) struct Fake {
    queue: VecDeque<PtyEvent>,
    after_write: VecDeque<Vec<PtyEvent>>,
    pub(crate) written: Arc<Mutex<Vec<Vec<u8>>>>,
    pub(crate) stopped: Arc<Mutex<bool>>,
}

pub(crate) fn data(s: &str) -> PtyEvent {
    PtyEvent::Data(s.as_bytes().to_vec())
}

impl Fake {
    pub(crate) fn new(start: Vec<PtyEvent>, after_write: Vec<Vec<PtyEvent>>) -> Self {
        Fake { queue: start.into(), after_write: after_write.into(), ..Default::default() }
    }
}

impl PtyIo for Fake {
    async fn next(&mut self) -> PtyEvent {
        if let Some(e) = self.queue.pop_front() {
            return e;
        }
        if *self.stopped.lock().unwrap() {
            return PtyEvent::Closed;
        }
        std::future::pending().await
    }
    async fn write(&mut self, data: &[u8]) {
        self.written.lock().unwrap().push(data.to_vec());
        if let Some(next) = self.after_write.pop_front() {
            self.queue.extend(next);
        }
    }
    async fn stop(&mut self) {
        *self.stopped.lock().unwrap() = true;
    }
}

/// Responde a cada pregunta con lo que diga `answers` (None = no darla) y anota las preguntas.
fn answering(answers: Vec<Option<&'static str>>) -> (mpsc::Sender<PromptAsk>, tokio::task::JoinHandle<Vec<String>>) {
    let (tx, mut rx) = mpsc::channel::<PromptAsk>(1);
    let task = tokio::spawn(async move {
        let mut seen = Vec::new();
        let mut answers = answers.into_iter();
        while let Some(ask) = rx.recv().await {
            seen.push(ask.prompt);
            let a = answers.next().flatten().map(|s| Zeroizing::new(s.to_string()));
            let _ = ask.reply.send(a);
        }
        seen
    });
    (tx, task)
}

fn opts() -> PtyOptions {
    PtyOptions { timeout_secs: 30, hint: None }
}

async fn run(fake: &mut Fake, answers: Vec<Option<&'static str>>) -> (PtyOutcome, Vec<String>) {
    let (tx, task) = answering(answers);
    let out = drive(fake, &opts(), &CancellationToken::new(), &tx).await;
    drop(tx);
    (out, task.await.unwrap())
}

#[tokio::test]
async fn passwd_dos_preguntas_y_la_contrasena_tapada_aunque_llegue_partida() {
    let mut fake = Fake::new(
        vec![data("Changing password for test.\r\nNew password: ")],
        vec![
            vec![data("\r\nRetype new password: ")],
            vec![
                data("\r\npasswd: ok (escribiste s3cr"),
                data("3t-pass)\r\n"),
                PtyEvent::Exit(0),
                PtyEvent::Closed,
            ],
        ],
    );
    let written = fake.written.clone();
    let (out, seen) = run(&mut fake, vec![Some(PW), Some(PW)]).await;
    assert_eq!(seen, ["New password:", "Retype new password:"]);
    assert_eq!(out.prompts, seen);
    assert_eq!(out.exit_code, Some(0));
    assert!(out.stop.is_none() && !out.timed_out && !out.canceled);
    assert!(!out.output.contains("s3cr"), "{}", out.output);
    assert!(out.output.contains(&format!("escribiste {MASK})")), "{}", out.output);
    assert!(!out.output.contains('\r'), "{:?}", out.output);
    let w = written.lock().unwrap().clone();
    assert_eq!(w, vec![format!("{PW}\n").into_bytes(); 2]);
    assert!(!*fake.stopped.lock().unwrap());
}

#[tokio::test]
async fn pregunta_repetida_detiene_el_programa() {
    let mut fake = Fake::new(vec![data("[sudo] password for test: ")], vec![vec![data("\r\nSorry, try again.\r\n[sudo] password for test: ")]]);
    let written = fake.written.clone();
    let (out, seen) = run(&mut fake, vec![Some("mala1234"), Some("otra")]).await;
    assert_eq!(seen.len(), 1, "no se vuelve a preguntar");
    assert_eq!(out.stop, Some(PtyStop::Repeated("[sudo] password for test:".into())));
    assert_eq!(written.lock().unwrap().len(), 1, "un solo intento");
    assert!(*fake.stopped.lock().unwrap());
}

#[tokio::test]
async fn si_el_usuario_no_la_da_se_detiene_sin_escribir() {
    let mut fake = Fake::new(vec![data("Password: ")], vec![]);
    let written = fake.written.clone();
    let (out, _) = run(&mut fake, vec![None]).await;
    assert_eq!(out.stop, Some(PtyStop::Refused("Password:".into())));
    assert!(written.lock().unwrap().is_empty());
    assert!(*fake.stopped.lock().unwrap());
}

#[tokio::test]
async fn contrasenas_con_salto_de_linea_no_se_escriben() {
    let mut fake = Fake::new(vec![data("Password: ")], vec![]);
    let written = fake.written.clone();
    let (out, _) = run(&mut fake, vec![Some("a\nrm -rf /")]).await;
    assert!(matches!(out.stop, Some(PtyStop::Refused(_))));
    assert!(written.lock().unwrap().is_empty());
}

#[tokio::test]
async fn pista_y_limite_de_preguntas() {
    let start = vec![data("Token 1 > ")];
    let after: Vec<Vec<PtyEvent>> = (2..=MAX_PROMPTS + 1).map(|i| vec![data(&format!("\r\nToken {i} > "))]).collect();
    let mut fake = Fake::new(start, after);
    let (tx, task) = answering(vec![Some("tok-secreto"); MAX_PROMPTS + 1]);
    let o = PtyOptions { timeout_secs: 30, hint: Some("token".into()) };
    let out = drive(&mut fake, &o, &CancellationToken::new(), &tx).await;
    drop(tx);
    assert_eq!(task.await.unwrap().len(), MAX_PROMPTS);
    assert_eq!(out.stop, Some(PtyStop::TooMany));
}

#[tokio::test(start_paused = true)]
async fn tiempo_limite_sin_contar_la_espera_al_usuario() {
    // El usuario tarda 100 s en responder (más que el límite de 30 s): no cuenta.
    let mut fake = Fake::new(vec![data("Password: ")], vec![vec![data("\r\nok\r\n"), PtyEvent::Exit(0), PtyEvent::Closed]]);
    let (tx, mut rx) = mpsc::channel::<PromptAsk>(1);
    let slow = tokio::spawn(async move {
        while let Some(ask) = rx.recv().await {
            tokio::time::sleep(Duration::from_secs(100)).await;
            let _ = ask.reply.send(Some(Zeroizing::new(PW.to_string())));
        }
    });
    let out = drive(&mut fake, &opts(), &CancellationToken::new(), &tx).await;
    drop(tx);
    slow.await.unwrap();
    assert!(!out.timed_out && out.exit_code == Some(0), "{out:?}");

    // Un programa que no termina: se corta por tiempo y se detiene.
    let mut fake = Fake::new(vec![data("trabajando…\r\n")], vec![]);
    let (out, _) = run(&mut fake, vec![]).await;
    assert!(out.timed_out && out.output.contains("trabajando"), "{out:?}");
    assert!(*fake.stopped.lock().unwrap());
}

#[tokio::test]
async fn cancelar_detiene_el_programa() {
    let mut fake = Fake::new(vec![], vec![]);
    let cancel = CancellationToken::new();
    let (tx, _task) = answering(vec![]);
    let c2 = cancel.clone();
    tokio::spawn(async move { c2.cancel() });
    let out = drive(&mut fake, &opts(), &cancel, &tx).await;
    assert!(out.canceled);
    assert!(*fake.stopped.lock().unwrap());
}

/// Contra el servidor de pruebas (`terview-sshd`, 127.0.0.1:2222): un programa tipo passwd con `read -s`
/// que pide dos veces y repite lo que leyó. Ejecutar con:
/// `cargo test --lib mcp::pty_run -- --ignored --test-threads=1`
#[tokio::test]
#[ignore]
async fn real_programa_que_pide_la_contrasena_dos_veces() {
    let session = crate::ssh::connect::testutil::connect_test_server().await;
    let script = "read -s -p 'New password: ' a; echo; read -s -p 'Retype new password: ' b; echo; \
                  [ \"$a\" = \"$b\" ] && echo \"iguales: $a\" || echo distintas; exit 3";
    let command = format!("bash -c {}", crate::mcp::sudo::sh_quote(script));
    let (tx, task) = answering(vec![Some(PW), Some(PW)]);
    let out = run_ssh(&session, &command, &opts(), &CancellationToken::new(), &tx).await.unwrap();
    drop(tx);
    assert_eq!(task.await.unwrap(), ["New password:", "Retype new password:"]);
    assert_eq!(out.exit_code, Some(3), "{out:?}");
    assert!(out.output.contains(&format!("iguales: {MASK}")), "{}", out.output);
    assert!(!out.output.contains("s3cr"), "{}", out.output);

    // Contraseña incorrecta repetida (como sudo): se detiene tras el primer intento.
    let script = "while true; do read -s -p 'Password: ' x; echo; echo 'Sorry, try again.'; done";
    let command = format!("bash -c {}", crate::mcp::sudo::sh_quote(script));
    let (tx, task) = answering(vec![Some("mala-123"), Some("mala-123")]);
    let out = run_ssh(&session, &command, &opts(), &CancellationToken::new(), &tx).await.unwrap();
    drop(tx);
    assert_eq!(task.await.unwrap().len(), 1);
    assert_eq!(out.stop, Some(PtyStop::Repeated("Password:".into())), "{out:?}");
}
