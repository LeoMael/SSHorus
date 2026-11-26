//! Pruebas en vivo de transferencias: subir y bajar un árbol, pausar, reanudar y cancelar, sesión
//! que ya no existe y enlaces simbólicos. Las utilidades están en `tests.rs`.

use super::*;

#[tokio::test]
#[ignore]
async fn live_roundtrip_tree() {
    let (engine, env, session) = setup(4).await;
    let remote = format!("/config/tmp-xfer-{}", uuid::Uuid::new_v4());
    remote_exec(&session, &format!("mkdir -p {remote}")).await;

    // Árbol: 320 archivos pequeños en carpetas anidadas + carpetas vacías.
    let src = tmp_dir("src");
    let small = src.join("pequenos");
    let mut seed = 1u64;
    for i in 0..8 {
        for j in 0..4 {
            let d = small.join(format!("d{i}")).join(format!("sub{j}"));
            std::fs::create_dir_all(&d).unwrap();
            for k in 0..10 {
                seed += 1;
                let len = ((seed * 7919) % 20_000) as usize;
                std::fs::write(d.join(format!("f{k}.bin")), pseudo_bytes(len, seed)).unwrap();
            }
        }
    }
    std::fs::create_dir_all(small.join("vacia/mas-vacia")).unwrap();
    std::fs::write(small.join("vacio.txt"), b"").unwrap();
    let script = small.join("script.sh");
    std::fs::write(&script, b"#!/bin/sh\necho hola\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    // Archivos grandes.
    let big = src.join("grandes");
    std::fs::create_dir_all(big.join("anidada")).unwrap();
    std::fs::write(big.join("a5.bin"), pseudo_bytes(5 * 1024 * 1024 + 123, 77)).unwrap();
    std::fs::write(big.join("anidada/b12.bin"), pseudo_bytes(12 * 1024 * 1024 + 7, 78)).unwrap();
    std::fs::write(big.join("c20.bin"), pseudo_bytes(20 * 1024 * 1024, 79)).unwrap();
    let sid = session.info.id.clone();

    // ── Subida: archivos pequeños
    let t = Instant::now();
    let b1 = engine.upload(sid.clone(), vec![small.to_string_lossy().into()], remote.clone());
    wait_batch(&engine, &b1, Duration::from_secs(120)).await;
    let d_small_up = t.elapsed();
    let (n_small, bytes_small) = assert_all_done(&engine, &b1);
    assert!(n_small >= 320);

    // ── Subida: archivos grandes
    let t = Instant::now();
    let b2 = engine.upload(sid.clone(), vec![big.to_string_lossy().into()], remote.clone());
    wait_batch(&engine, &b2, Duration::from_secs(120)).await;
    let d_big_up = t.elapsed();
    let (_, bytes_big) = assert_all_done(&engine, &b2);

    // ── Bajada de todo
    let dst = tmp_dir("dst");
    let t = Instant::now();
    let b3 = engine.download(sid.clone(), vec![format!("{remote}/pequenos")], dst.to_string_lossy().into());
    wait_batch(&engine, &b3, Duration::from_secs(120)).await;
    let d_small_down = t.elapsed();
    assert_all_done(&engine, &b3);
    let t = Instant::now();
    let b4 = engine.download(sid.clone(), vec![format!("{remote}/grandes")], dst.to_string_lossy().into());
    wait_batch(&engine, &b4, Duration::from_secs(120)).await;
    let d_big_down = t.elapsed();
    assert_all_done(&engine, &b4);

    println!(
        "\n[transfer] {n_small} archivos pequeños ({:.1} MB): subida {:.2?} = {:.0} archivos/s, bajada {:.2?} = {:.0} archivos/s",
        bytes_small as f64 / 1_048_576.0,
        d_small_up,
        n_small as f64 / d_small_up.as_secs_f64(),
        d_small_down,
        n_small as f64 / d_small_down.as_secs_f64(),
    );
    println!(
        "[transfer] grandes ({:.1} MB): subida {:.2?} = {:.1} MB/s, bajada {:.2?} = {:.1} MB/s\n",
        bytes_big as f64 / 1_048_576.0,
        d_big_up,
        mbps(bytes_big, d_big_up),
        d_big_down,
        mbps(bytes_big, d_big_down),
    );

    assert_same_tree(&src, &dst);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let m = std::fs::metadata(dst.join("pequenos/script.sh")).unwrap().permissions().mode();
        assert!(m & 0o100 != 0, "se perdió el bit de ejecución (modo {m:o})");
    }

    // Limpiar terminados emite los ids quitados.
    let removed = engine.clear_finished();
    assert!(removed.len() >= n_small);
    assert!(engine.list().is_empty());
    assert_eq!(env.removed.lock().unwrap().len(), removed.len());
    assert!(!env.updates.lock().unwrap().is_empty());

    remote_exec(&session, &format!("rm -rf {remote}")).await;
    std::fs::remove_dir_all(&src).ok();
    std::fs::remove_dir_all(&dst).ok();
}

#[tokio::test]
#[ignore]
async fn live_pause_resume_and_cancel() {
    let (engine, _env, session) = setup(2).await;
    let remote = format!("/config/tmp-xfer-{}", uuid::Uuid::new_v4());
    remote_exec(&session, &format!("mkdir -p {remote}")).await;
    let sid = session.info.id.clone();
    let src = tmp_dir("pr-src");
    let size = 96 * 1024 * 1024 + 4321;
    let data = pseudo_bytes(size, 5);
    let file = src.join("grande.bin");
    std::fs::write(&file, &data).unwrap();

    // ── Subida: pausar a mitad y reanudar
    let b = engine.upload(sid.clone(), vec![file.to_string_lossy().into()], remote.clone());
    let j = wait_progress(&engine, &b, 2 * 1024 * 1024).await;
    engine.pause(std::slice::from_ref(&b));
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    let paused = batch_jobs(&engine, &b).remove(0);
    println!("[transfer] subida pausada en {} / {} bytes ({:?})", paused.transferred, size, paused.status);
    if j.status != TransferStatus::Done {
        assert_eq!(paused.status, TransferStatus::Paused);
        assert!(paused.transferred < size as u64);
    }
    engine.resume(std::slice::from_ref(&j.id));
    tokio::time::sleep(Duration::from_millis(50)).await;
    wait_batch(&engine, &b, Duration::from_secs(60)).await;
    assert_all_done(&engine, &b);

    // ── Bajada: pausar a mitad, reanudar y comparar
    let dst = tmp_dir("pr-dst");
    let b = engine.download(sid.clone(), vec![format!("{remote}/grande.bin")], dst.to_string_lossy().into());
    wait_progress(&engine, &b, 2 * 1024 * 1024).await;
    engine.pause(std::slice::from_ref(&b));
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    let paused = batch_jobs(&engine, &b).remove(0);
    println!("[transfer] bajada pausada en {} / {} bytes ({:?})", paused.transferred, size, paused.status);
    engine.resume(std::slice::from_ref(&b));
    tokio::time::sleep(Duration::from_millis(50)).await;
    wait_batch(&engine, &b, Duration::from_secs(60)).await;
    assert_all_done(&engine, &b);
    let got = std::fs::read(dst.join("grande.bin")).unwrap();
    assert!(got == data, "el archivo reanudado difiere");

    // ── Cancelar subida a mitad: el parcial remoto desaparece
    let b = engine.upload(sid.clone(), vec![file.to_string_lossy().into()], format!("{remote}/otra"));
    // (la carpeta "otra" no existe: la subida la crea con mkdir -p)
    let j = wait_progress(&engine, &b, 1024 * 1024).await;
    engine.cancel(std::slice::from_ref(&j.id));
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    let c = batch_jobs(&engine, &b).remove(0);
    if c.status == TransferStatus::Canceled {
        let mut ch = session.open_channel().await.unwrap();
        ch.exec(true, format!("test -e {remote}/otra/grande.bin")).await.unwrap();
        let mut code = None;
        while let Some(msg) = ch.wait().await {
            if let russh::ChannelMsg::ExitStatus { exit_status } = msg {
                code = Some(exit_status);
                break;
            }
        }
        assert_eq!(code, Some(1), "el parcial remoto sigue existiendo");
    } else {
        println!("[transfer] la subida terminó antes de cancelar ({:?})", c.status);
    }

    // ── Cancelar bajada a mitad: el parcial local desaparece
    let dst2 = tmp_dir("pr-dst2");
    let b = engine.download(sid.clone(), vec![format!("{remote}/grande.bin")], dst2.to_string_lossy().into());
    wait_progress(&engine, &b, 1024 * 1024).await;
    engine.cancel(std::slice::from_ref(&b));
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    let c = batch_jobs(&engine, &b).remove(0);
    if c.status == TransferStatus::Canceled {
        assert!(!dst2.join("grande.bin").exists(), "el parcial local sigue existiendo");
    }

    // ── Reintentar: un error (origen inexistente) queda como error y no se cuelga
    let b = engine.download(sid.clone(), vec![format!("{remote}/no-existe")], dst2.to_string_lossy().into());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    let e = batch_jobs(&engine, &b).remove(0);
    assert_eq!(e.status, TransferStatus::Error);
    println!("[transfer] error esperado: {:?}", e.error);

    remote_exec(&session, &format!("rm -rf {remote}")).await;
    std::fs::remove_dir_all(&src).ok();
    std::fs::remove_dir_all(&dst).ok();
    std::fs::remove_dir_all(&dst2).ok();
}

#[tokio::test]
#[ignore]
async fn live_session_gone() {
    let (engine, env, session) = setup(4).await;
    // Sin reconexión automática: falla enseguida.
    env.auto_reconnect.store(false, Ordering::Relaxed);
    let src = tmp_dir("gone");
    std::fs::write(src.join("a.txt"), b"hola").unwrap();
    let b = engine.upload("no-existe".into(), vec![src.join("a.txt").to_string_lossy().into()], "/config".into());
    wait_batch(&engine, &b, Duration::from_secs(10)).await;
    let j = batch_jobs(&engine, &b).remove(0);
    assert_eq!(j.status, TransferStatus::Error);
    assert_eq!(j.error.as_deref(), Some(crate::transfer::engine::CLOSED_MSG));
    drop(session);
    std::fs::remove_dir_all(&src).ok();
}

#[cfg(unix)]
#[tokio::test]
#[ignore]
async fn live_symlink_roundtrip() {
    use std::os::unix::fs::symlink;
    let (engine, _env, session) = setup(4).await;
    let sid = session.info.id.clone();
    let remote = format!("/config/tmp-links-{}", uuid::Uuid::new_v4());
    remote_exec(&session, &format!("mkdir -p {remote}")).await;

    let src = tmp_dir("links-src");
    let root = src.join("arbol");
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("a.txt"), b"hola").unwrap();
    std::fs::write(root.join("sub/b.txt"), b"mundo").unwrap();
    symlink("a.txt", root.join("rel")).unwrap(); // relativo a archivo
    symlink("sub", root.join("dir-link")).unwrap(); // a carpeta (no se sigue)
    symlink("/etc/hostname", root.join("abs")).unwrap(); // absoluto
    symlink("no-existe", root.join("roto")).unwrap(); // colgante
    symlink("..", root.join("sub/bucle")).unwrap(); // bucle: no debe recorrerse

    let b = engine.upload(sid.clone(), vec![root.to_string_lossy().into()], remote.clone());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_all_done(&engine, &b);
    let out = remote_out(
        &session,
        &format!("cd {remote}/arbol && for l in rel dir-link abs roto sub/bucle; do printf '%s=%s\\n' $l \"$(readlink $l)\"; done"),
    )
    .await;
    println!("[enlaces] remoto:\n{out}");
    for (l, t) in [("rel", "a.txt"), ("dir-link", "sub"), ("abs", "/etc/hostname"), ("roto", "no-existe"), ("sub/bucle", "..")] {
        assert!(out.contains(&format!("{l}={t}\n")), "el enlace remoto {l} no apunta a {t}");
    }

    // Bajada: los enlaces vuelven como enlaces locales con el mismo destino.
    let dst = tmp_dir("links-dst");
    let b = engine.download(sid.clone(), vec![format!("{remote}/arbol")], dst.to_string_lossy().into());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_all_done(&engine, &b);
    let back = dst.join("arbol");
    for (l, t) in [("rel", "a.txt"), ("dir-link", "sub"), ("abs", "/etc/hostname"), ("roto", "no-existe"), ("sub/bucle", "..")] {
        let m = std::fs::symlink_metadata(back.join(l)).unwrap();
        assert!(m.file_type().is_symlink(), "{l} no es un enlace");
        assert_eq!(std::fs::read_link(back.join(l)).unwrap(), PathBuf::from(t));
    }
    assert_eq!(std::fs::read(back.join("sub/b.txt")).unwrap(), b"mundo");

    // Volver a bajar con "sobrescribir": los enlaces se reemplazan sin errores.
    let b = engine.download(sid.clone(), vec![format!("{remote}/arbol")], dst.to_string_lossy().into());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_all_done(&engine, &b);
    // Y volver a subir: igual.
    let b = engine.upload(sid.clone(), vec![root.to_string_lossy().into()], remote.clone());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_all_done(&engine, &b);

    remote_exec(&session, &format!("rm -rf {remote}")).await;
    std::fs::remove_dir_all(&src).ok();
    std::fs::remove_dir_all(&dst).ok();
}
