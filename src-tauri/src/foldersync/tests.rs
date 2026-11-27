//! Prueba en vivo contra el servidor de pruebas (las unitarias están junto a cada parte).
//!
//! cargo test --lib foldersync -- --ignored --test-threads=1 --nocapture

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use futures::future::BoxFuture;

use super::hub::{Hub, StartOptions, SyncEnv};
use super::model::{SyncInfo, SyncSpec};
use crate::error::{AppError, AppResult};
use crate::sftp::SftpStore;
use crate::ssh::connect::testutil::connect_test_server;
use crate::ssh::SshSession;
use crate::transfer::{Conflict, ConflictQuestion, Engine, TransferEnv};
use crate::types::TransferJob;

struct TestEnv {
    session: Arc<SshSession>,
    sftp: SftpStore,
    engine: Mutex<Option<Arc<Engine>>>,
}

impl TransferEnv for TestEnv {
    fn session<'a>(&'a self, id: &'a str) -> BoxFuture<'a, AppResult<Arc<SshSession>>> {
        Box::pin(async move {
            if id == self.session.info.id {
                Ok(self.session.clone())
            } else {
                Err(AppError::SessionNotFound(id.into()))
            }
        })
    }
    fn concurrency(&self) -> usize {
        2
    }
    fn conflict_policy(&self) -> Conflict {
        Conflict::Ask
    }
    fn auto_reconnect(&self) -> bool {
        false
    }
    fn emit_update(&self, _: Vec<TransferJob>) {}
    fn emit_removed(&self, _: Vec<String>) {}
    fn emit_conflict(&self, _: ConflictQuestion) {}
    fn emit_conflict_done(&self, _: Vec<String>) {}
}

struct SyncTestEnv(Arc<TestEnv>);

impl SyncEnv for SyncTestEnv {
    fn session<'a>(&'a self, id: &'a str) -> BoxFuture<'a, AppResult<Arc<SshSession>>> {
        TransferEnv::session(self.0.as_ref(), id)
    }
    fn sftp(&self) -> &SftpStore {
        &self.0.sftp
    }
    fn engine(&self) -> Arc<Engine> {
        let mut g = self.0.engine.lock().unwrap();
        g.get_or_insert_with(|| Engine::new(self.0.clone())).clone()
    }
    fn emit(&self, _: Vec<SyncInfo>) {}
}

async fn wait_for<F: AsyncFnMut() -> bool>(what: &str, mut f: F) {
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(15) {
        if f().await {
            return;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    panic!("no llegó a tiempo: {what}");
}

fn set_old_mtime(path: &Path) {
    let f = std::fs::File::options().write(true).open(path).unwrap();
    f.set_modified(SystemTime::now() - Duration::from_secs(3600)).unwrap();
}

fn spec_of(local: &Path, remote: &str) -> SyncSpec {
    SyncSpec {
        local_dir: local.to_string_lossy().into_owned(),
        remote_dir: remote.to_string(),
        ignore: vec![],
        delete_remote: false,
    }
}

#[tokio::test]
#[ignore]
async fn live_folder_sync_uploads_saved_files() {
    let session = connect_test_server().await;
    let env = Arc::new(TestEnv { session: session.clone(), sftp: SftpStore::default(), engine: Mutex::new(None) });
    let hub = Hub::new(Arc::new(SyncTestEnv(env.clone())));
    let sftp = &env.sftp;
    let remote = format!("/config/tmp-foldersync-{}", uuid::Uuid::new_v4().simple());
    let local = std::env::temp_dir().join(format!("sshorus-foldersync-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(local.join("sub")).unwrap();
    std::fs::create_dir_all(local.join("node_modules")).unwrap();
    std::fs::write(local.join("a.txt"), "local").unwrap();
    set_old_mtime(&local.join("a.txt"));
    std::fs::write(local.join("sub/b.txt"), "uno").unwrap();
    std::fs::write(local.join("node_modules/x.js"), "x").unwrap();
    sftp.mkdir(&session, &remote).await.unwrap();
    sftp.write_text(&session, &format!("{remote}/a.txt"), "del servidor, más nuevo").await.unwrap();

    let spec = spec_of(&local, &format!("{remote}/"));
    let sid = session.info.id.clone();
    let p = hub.preview(&sid, spec.clone()).await.unwrap();
    assert_eq!(p.to_upload.iter().map(|i| i.rel.as_str()).collect::<Vec<_>>(), vec!["sub/b.txt"]);
    assert_eq!(p.remote_newer.iter().map(|i| i.rel.as_str()).collect::<Vec<_>>(), vec!["a.txt"]);

    let opts = StartOptions { upload: true, overwrite_newer: false, remembered: false };
    let info = hub.start(&sid, spec.clone(), opts).await.unwrap();
    assert_eq!(info.spec.remote_dir, remote);
    assert!(hub.start(&sid, spec, opts).await.is_err(), "la misma carpeta dos veces");

    let read = async |rel: &str| sftp.read_text(&session, &format!("{remote}/{rel}"), 1 << 20).await.ok().map(|t| t.content);
    wait_for("subida inicial", async || read("sub/b.txt").await.as_deref() == Some("uno")).await;

    // Guardar en el PC: cambia uno, aparece otro y un temporal del editor que no debe subir.
    std::fs::write(local.join("sub/b.txt"), "dos, más largo").unwrap();
    std::fs::create_dir_all(local.join("nueva/honda")).unwrap();
    std::fs::write(local.join("nueva/honda/c.txt"), "c").unwrap();
    std::fs::write(local.join(".b.txt.swp"), "temporal").unwrap();
    wait_for("cambios subidos", async || {
        read("sub/b.txt").await.as_deref() == Some("dos, más largo") && read("nueva/honda/c.txt").await.as_deref() == Some("c")
    })
    .await;
    wait_for("estado al día", async || hub.list().first().is_some_and(|i| i.pending == 0 && i.last_file.is_some())).await;
    assert_eq!(read("a.txt").await.as_deref(), Some("del servidor, más nuevo"), "no pisa lo más nuevo del servidor");
    assert!(read(".b.txt.swp").await.is_none());
    assert!(read("node_modules/x.js").await.is_none());

    // Sin «borrar también en el servidor», borrar en el PC no toca el servidor.
    std::fs::remove_file(local.join("nueva/honda/c.txt")).unwrap();
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(read("nueva/honda/c.txt").await.as_deref(), Some("c"));

    assert!(hub.remove(&info.id).is_some());
    assert!(hub.list().is_empty());

    // Con «borrar también en el servidor», sí se borra (solo ese archivo).
    let spec = SyncSpec { delete_remote: true, ..spec_of(&local, &remote) };
    let opts = StartOptions { upload: false, overwrite_newer: false, remembered: false };
    let info = hub.start(&sid, spec, opts).await.unwrap();
    std::fs::remove_file(local.join("sub/b.txt")).unwrap();
    wait_for("borrado en el servidor", async || read("sub/b.txt").await.is_none()).await;
    assert_eq!(read("a.txt").await.as_deref(), Some("del servidor, más nuevo"));
    hub.remove(&info.id);
    sftp.delete(&session, std::slice::from_ref(&remote)).await.unwrap();
    std::fs::remove_dir_all(&local).unwrap();
}
