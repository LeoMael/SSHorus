//! Arrastre directo contra el servidor SSH de pruebas (`#[ignore]`: necesita el contenedor).

use std::sync::Arc;

use russh_sftp::client::SftpSession;
use tokio::io::AsyncWriteExt;

use super::jobs::{JobSink, Jobs};
use super::list::collect;
use super::reader::{BlockingReader, Opener, Track};
use crate::ssh::connect::testutil::connect_test_server;
use crate::types::TransferJob;

struct NoSink;

impl JobSink for NoSink {
    fn update(&self, _jobs: Vec<TransferJob>) {}
    fn removed(&self, _ids: Vec<String>) {}
}

async fn put(sftp: &SftpSession, path: &str, data: &[u8]) {
    let mut f = sftp.create(path.to_string()).await.unwrap();
    f.write_all(data).await.unwrap();
    f.shutdown().await.unwrap();
}

async fn cleanup(sftp: &SftpSession, base: &str) {
    for f in ["sub/b.bin", "a.txt"] {
        let _ = sftp.remove_file(format!("{base}/{f}")).await;
    }
    let _ = sftp.remove_dir(format!("{base}/sub")).await;
    let _ = sftp.remove_dir(base.to_string()).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore]
async fn lista_y_lee_por_sftp_real() {
    let ssh = connect_test_server().await;
    let sftp = Arc::new(ssh.open_sftp().await.unwrap());
    let base = format!("/config/tmp-arrastre-{}", uuid::Uuid::new_v4().simple());
    sftp.create_dir(base.clone()).await.unwrap();
    sftp.create_dir(format!("{base}/sub")).await.unwrap();
    let data: Vec<u8> = (0..700_000u32).map(|i| (i % 253) as u8).collect();
    put(&sftp, &format!("{base}/sub/b.bin"), &data).await;
    put(&sftp, &format!("{base}/a.txt"), b"hola").await;

    let list = collect(sftp.as_ref(), std::slice::from_ref(&base)).await.unwrap();
    let root = base.rsplit('/').next().unwrap().to_string();
    let find = |rel: &str| list.iter().find(|e| e.rel == rel).cloned();
    assert!(find(&root).is_some_and(|e| e.is_dir));
    assert_eq!(find(&format!("{root}\\a.txt")).map(|e| e.size), Some(4));
    let b = find(&format!("{root}\\sub\\b.bin")).unwrap();
    assert_eq!(b.size, data.len() as u64);
    let sub = list.iter().position(|e| e.rel == format!("{root}\\sub")).unwrap();
    let bin = list.iter().position(|e| e.rel == b.rel).unwrap();
    assert!(sub < bin, "la carpeta va antes que su contenido");

    let (s, remote) = (sftp.clone(), b.remote.clone());
    let opener: Opener<_> = Box::new(move || {
        let (s, remote) = (s.clone(), remote.clone());
        Box::pin(async move { s.open(remote).await.map_err(std::io::Error::other) })
    });
    let jobs = Jobs::new(tokio::runtime::Handle::current(), Arc::new(NoSink));
    let track: Track = Box::new(move || jobs.add("lote", "s", "b.bin", "/b.bin", 700_000));
    let reader = BlockingReader::new(tokio::runtime::Handle::current(), opener, b.size, track);
    // El sistema lee desde un hilo suyo, fuera de tokio.
    let got = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let c = reader.read(&mut buf).unwrap();
            out.extend_from_slice(&buf[..c.len]);
            if c.eof {
                break out;
            }
        }
    })
    .await
    .unwrap();
    assert!(got == data, "lo leído no coincide ({} bytes)", got.len());
    cleanup(&sftp, &base).await;
}
