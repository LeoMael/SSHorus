//! Pruebas en vivo de transferencias: concurrencia por sesión y reanudar tras caerse la conexión.

use super::*;

#[tokio::test]
#[ignore]
async fn live_per_session_concurrency() {
    const N: usize = 2;
    let (engine, env, s1) = setup(N).await;
    let s2 = connect_test_server().await;
    env.sessions.lock().unwrap().insert(s2.info.id.clone(), s2.clone());
    let remote = format!("/config/tmp-conc-{}", uuid::Uuid::new_v4());
    remote_exec(&s1, &format!("mkdir -p {remote}/uno {remote}/dos")).await;

    let src = tmp_dir("conc");
    let files = src.join("lote");
    std::fs::create_dir_all(&files).unwrap();
    for i in 0..10 {
        std::fs::write(files.join(format!("f{i}.bin")), pseudo_bytes(3 * 1024 * 1024, i)).unwrap();
    }
    let b1 = engine.upload(s1.info.id.clone(), vec![files.to_string_lossy().into()], format!("{remote}/uno"));
    let b2 = engine.upload(s2.info.id.clone(), vec![files.to_string_lossy().into()], format!("{remote}/dos"));

    let (mut max1, mut max2, mut max_total) = (0usize, 0usize, 0usize);
    let t0 = Instant::now();
    while !(engine.batch_finished(&b1) && engine.batch_finished(&b2)) {
        let list = engine.list();
        let run = |sid: &str| list.iter().filter(|j| j.session_id == sid && j.status == TransferStatus::Running).count();
        let (r1, r2) = (run(&s1.info.id), run(&s2.info.id));
        max1 = max1.max(r1);
        max2 = max2.max(r2);
        max_total = max_total.max(r1 + r2);
        assert!(t0.elapsed() < Duration::from_secs(120), "no terminó a tiempo");
        tokio::time::sleep(Duration::from_millis(2)).await;
    }
    println!("[concurrencia] máx. por sesión: {max1} y {max2}; total simultáneo: {max_total} (límite {N} por sesión)");
    assert!(max1 <= N && max2 <= N, "se superó el límite por sesión");
    assert!(max_total > N, "el límite parece global (total {max_total})");
    assert_all_done(&engine, &b1);
    assert_all_done(&engine, &b2);

    remote_exec(&s1, &format!("rm -rf {remote}")).await;
    std::fs::remove_dir_all(&src).ok();
}

#[tokio::test]
#[ignore]
async fn live_resume_session_after_drop() {
    let (engine, env, session_a) = setup(2).await;
    // Alias estable para la sesión (como el sessionId que conserva la reconexión).
    let sid = "sesion-reconectable".to_string();
    env.sessions.lock().unwrap().insert(sid.clone(), session_a.clone());
    let remote = format!("/config/tmp-resume-{}", uuid::Uuid::new_v4());
    remote_exec(&session_a, &format!("mkdir -p {remote}")).await;
    let src = tmp_dir("resume");
    let size = 64 * 1024 * 1024 + 99;
    let data = pseudo_bytes(size, 42);
    std::fs::write(src.join("grande.bin"), &data).unwrap();
    for i in 0..6 {
        std::fs::write(src.join(format!("p{i}.txt")), format!("pequeño {i}")).unwrap();
    }
    let paths = |names: &[&str]| -> Vec<String> { names.iter().map(|n| src.join(n).to_string_lossy().into()).collect() };

    // ── 1) Solo mueren los canales (la conexión sigue): reintento transparente.
    let b = engine.upload(sid.clone(), paths(&["grande.bin"]), remote.clone());
    wait_progress(&engine, &b, 4 * 1024 * 1024).await;
    engine.pools().kill_channels(&sid);
    wait_batch(&engine, &b, Duration::from_secs(90)).await;
    assert_all_done(&engine, &b);
    println!("[reconexión] canales cerrados a mitad: la subida terminó con reintento");

    // ── 2) Cae la conexión entera durante una subida grande + varios archivos en cola.
    let mut names = vec!["grande.bin"];
    let small: Vec<String> = (0..6).map(|i| format!("p{i}.txt")).collect();
    names.extend(small.iter().map(|s| s.as_str()));
    let b = engine.upload(sid.clone(), paths(&names), format!("{remote}/dos"));
    let before = wait_progress(&engine, &b, 8 * 1024 * 1024).await;
    engine.pools().kill_channels(&sid);
    session_a
        .handle
        .disconnect(russh::Disconnect::ByApplication, "prueba", "es")
        .await
        .ok();
    env.sessions.lock().unwrap().remove(&sid);
    assert!(wait_until(Duration::from_secs(5), || session_a.is_closed()).await);

    // Nada pasa a error: todo espera en cola ("Esperando reconexión…").
    let parked = wait_until(Duration::from_secs(15), || {
        let jobs = batch_jobs(&engine, &b);
        jobs.iter().any(|j| j.name == "grande.bin" && j.status == TransferStatus::Queued && j.error.as_deref() == Some(WAITING_MSG))
            && jobs.iter().all(|j| matches!(j.status, TransferStatus::Queued | TransferStatus::Done))
    })
    .await;
    let snapshot: Vec<_> = batch_jobs(&engine, &b).into_iter().map(|j| (j.name, j.status, j.error, j.transferred)).collect();
    assert!(parked, "los trabajos no quedaron esperando: {snapshot:?}");
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(
        batch_jobs(&engine, &b).iter().all(|j| j.status != TransferStatus::Error && j.status != TransferStatus::Running),
        "algún trabajo se ejecutó o falló sin conexión"
    );
    let waiting = batch_jobs(&engine, &b).into_iter().find(|j| j.name == "grande.bin").unwrap();
    println!(
        "[reconexión] en espera: grande.bin en {} bytes (antes del corte {})",
        waiting.transferred, before.transferred
    );

    // Reconecta (conexión nueva, MISMO id) y avisa al motor.
    let session_b = connect_test_server().await;
    env.sessions.lock().unwrap().insert(sid.clone(), session_b.clone());
    env.updates.lock().unwrap().clear();
    engine.resume_session(&sid);
    wait_batch(&engine, &b, Duration::from_secs(120)).await;
    assert_all_done(&engine, &b);
    // El trabajo grande continuó desde su desplazamiento: nunca volvió a bajar de ahí.
    let min_after = env
        .updates
        .lock()
        .unwrap()
        .iter()
        .filter(|j| j.id == waiting.id)
        .map(|j| j.transferred)
        .min()
        .unwrap_or(0);
    println!("[reconexión] tras reanudar, progreso mínimo visto: {min_after} bytes");
    assert!(waiting.transferred > 0, "no había progreso confirmado antes del corte");
    assert!(min_after >= waiting.transferred, "la subida volvió a empezar desde 0");

    // Comparar contenido remoto (bajándolo).
    let dst = tmp_dir("resume-dst");
    let d = engine.download(sid.clone(), vec![format!("{remote}/dos/grande.bin")], dst.to_string_lossy().into());
    wait_batch(&engine, &d, Duration::from_secs(60)).await;
    assert_all_done(&engine, &d);
    assert!(std::fs::read(dst.join("grande.bin")).unwrap() == data, "el archivo reanudado difiere");

    // ── 3) Pérdida definitiva y luego reconexión: los errores por la caída se reanudan.
    let b = engine.upload(sid.clone(), paths(&["grande.bin"]), format!("{remote}/tres"));
    wait_progress(&engine, &b, 4 * 1024 * 1024).await;
    session_b
        .handle
        .disconnect(russh::Disconnect::ByApplication, "prueba", "es")
        .await
        .ok();
    env.sessions.lock().unwrap().remove(&sid);
    assert!(
        wait_until(Duration::from_secs(15), || batch_jobs(&engine, &b)[0].status == TransferStatus::Queued).await,
        "no quedó esperando"
    );
    engine.session_closed(&sid);
    assert!(wait_until(Duration::from_secs(5), || {
        let j = &batch_jobs(&engine, &b)[0];
        j.status == TransferStatus::Error && j.error.as_deref() == Some(CLOSED_MSG)
    })
    .await);
    let session_c = connect_test_server().await;
    env.sessions.lock().unwrap().insert(sid.clone(), session_c.clone());
    engine.resume_session(&sid);
    tokio::time::sleep(Duration::from_millis(50)).await;
    wait_batch(&engine, &b, Duration::from_secs(120)).await;
    assert_all_done(&engine, &b);

    remote_exec(&session_c, &format!("rm -rf {remote}")).await;
    std::fs::remove_dir_all(&src).ok();
    std::fs::remove_dir_all(&dst).ok();
}
