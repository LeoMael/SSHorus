//! Pruebas en vivo de transferencias: políticas de conflicto y la política «preguntar».

use super::*;

#[tokio::test]
#[ignore]
async fn live_conflict_policies() {
    let (engine, env, session) = setup(4).await;
    let sid = session.info.id.clone();
    let remote = format!("/config/tmp-conf-{}", uuid::Uuid::new_v4());
    // Remoto: a.txt reciente (1 h), b.txt viejo (2 días).
    remote_exec(
        &session,
        &format!(
            "mkdir -p {remote}/pol && printf remoto-a > {remote}/pol/a.txt && printf remoto-b > {remote}/pol/b.txt \
             && touch -d '1 hour ago' {remote}/pol/a.txt && touch -d '2 days ago' {remote}/pol/b.txt"
        ),
    )
    .await;
    // Local: a, b y c con fecha de hace 1 día.
    let src = tmp_dir("conf-src");
    let pol = src.join("pol");
    std::fs::create_dir_all(&pol).unwrap();
    for n in ["a", "b", "c"] {
        let p = pol.join(format!("{n}.txt"));
        std::fs::write(&p, format!("local-{n}")).unwrap();
        set_mtime(&p, 86_400);
    }
    let cat = |f: &'static str| {
        let s = session.clone();
        let r = remote.clone();
        async move { remote_out(&s, &format!("cat {r}/pol/{f}")).await }
    };

    // ── skip: a y b existen → omitidos; c no existe → subido
    *env.policy.lock().unwrap() = Conflict::Skip;
    let b = engine.upload(sid.clone(), vec![pol.to_string_lossy().into()], remote.clone());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_eq!(status_of(&engine, &b, "pol/a.txt").0, TransferStatus::Skipped);
    assert_eq!(status_of(&engine, &b, "pol/b.txt").0, TransferStatus::Skipped);
    assert_eq!(status_of(&engine, &b, "pol/c.txt").0, TransferStatus::Done);
    assert_eq!(cat("a.txt").await, "remoto-a");
    assert_eq!(cat("c.txt").await, "local-c");

    // ── newer: a remoto es más nuevo → omitido; b remoto es más viejo → subido
    *env.policy.lock().unwrap() = Conflict::Newer;
    let b = engine.upload(sid.clone(), vec![pol.to_string_lossy().into()], remote.clone());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    let (st, why) = status_of(&engine, &b, "pol/a.txt");
    assert_eq!(st, TransferStatus::Skipped);
    println!("[conflictos] newer omite a.txt: {why:?}");
    assert_eq!(status_of(&engine, &b, "pol/b.txt").0, TransferStatus::Done);
    // c remoto tiene la misma fecha que el local (se copió la fecha) → omitido
    assert_eq!(status_of(&engine, &b, "pol/c.txt").0, TransferStatus::Skipped);
    assert_eq!(cat("a.txt").await, "remoto-a");
    assert_eq!(cat("b.txt").await, "local-b");

    // ── overwrite: todo se sube
    *env.policy.lock().unwrap() = Conflict::Overwrite;
    let b = engine.upload(sid.clone(), vec![pol.to_string_lossy().into()], remote.clone());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_all_done(&engine, &b);
    assert_eq!(cat("a.txt").await, "local-a");

    // ── Bajadas. Remoto: a reciente (ahora), b de hace 3 días. Local: a y b de hace 1 día.
    remote_exec(
        &session,
        &format!(
            "printf remoto2-a > {remote}/pol/a.txt && printf remoto2-b > {remote}/pol/b.txt \
             && touch -d '3 days ago' {remote}/pol/b.txt"
        ),
    )
    .await;
    let dst = tmp_dir("conf-dst");
    let lpol = dst.join("pol");
    std::fs::create_dir_all(&lpol).unwrap();
    for n in ["a", "b"] {
        let p = lpol.join(format!("{n}.txt"));
        std::fs::write(&p, format!("viejo-{n}")).unwrap();
        set_mtime(&p, 86_400);
    }
    let read = |n: &str| std::fs::read_to_string(lpol.join(n)).unwrap();

    *env.policy.lock().unwrap() = Conflict::Skip;
    let b = engine.download(sid.clone(), vec![format!("{remote}/pol")], dst.to_string_lossy().into());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_eq!(status_of(&engine, &b, "pol/a.txt").0, TransferStatus::Skipped);
    assert_eq!(status_of(&engine, &b, "pol/b.txt").0, TransferStatus::Skipped);
    assert_eq!(status_of(&engine, &b, "pol/c.txt").0, TransferStatus::Done);
    assert_eq!(read("a.txt"), "viejo-a");

    *env.policy.lock().unwrap() = Conflict::Newer;
    let b = engine.download(sid.clone(), vec![format!("{remote}/pol")], dst.to_string_lossy().into());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_eq!(status_of(&engine, &b, "pol/a.txt").0, TransferStatus::Done);
    assert_eq!(status_of(&engine, &b, "pol/b.txt").0, TransferStatus::Skipped);
    assert_eq!(read("a.txt"), "remoto2-a");
    assert_eq!(read("b.txt"), "viejo-b");

    *env.policy.lock().unwrap() = Conflict::Overwrite;
    let b = engine.download(sid.clone(), vec![format!("{remote}/pol")], dst.to_string_lossy().into());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_all_done(&engine, &b);
    assert_eq!(read("b.txt"), "remoto2-b");

    // Limpiar incluye los omitidos.
    engine.clear_finished();
    assert!(engine.list().is_empty());

    remote_exec(&session, &format!("rm -rf {remote}")).await;
    std::fs::remove_dir_all(&src).ok();
    std::fs::remove_dir_all(&dst).ok();
}

// ───────────────────────── Política "preguntar" ─────────────────────────

/// Espera hasta que haya `n` preguntas pendientes en el lote y las devuelve.
async fn wait_questions(engine: &Engine, batch: &str, n: usize) -> Vec<ConflictQuestion> {
    let ok = wait_until(Duration::from_secs(30), || {
        engine.conflicts().iter().filter(|q| q.batch_id == batch).count() >= n
    })
    .await;
    assert!(ok, "no llegaron {n} preguntas");
    engine.conflicts().into_iter().filter(|q| q.batch_id == batch).collect()
}

#[tokio::test]
#[ignore]
async fn live_conflict_ask() {
    let (engine, env, session) = setup(2).await;
    let sid = session.info.id.clone();
    let remote = format!("/config/tmp-ask-{}", uuid::Uuid::new_v4());
    // Remoto: a, b, c y d existen; e no.
    remote_exec(
        &session,
        &format!(
            "mkdir -p {remote}/q && for n in a b c d; do printf remoto-$n > {remote}/q/$n.txt; done \
             && touch -d '2 days ago' {remote}/q/d.txt"
        ),
    )
    .await;
    let src = tmp_dir("ask-src");
    let q = src.join("q");
    std::fs::create_dir_all(&q).unwrap();
    for n in ["a", "b", "c", "d", "e"] {
        std::fs::write(q.join(format!("{n}.txt")), format!("local-{n}")).unwrap();
    }
    set_mtime(&q.join("d.txt"), 86_400);
    let cat = |f: String| {
        let s = session.clone();
        let r = remote.clone();
        async move { remote_out(&s, &format!("cat '{r}/q/{f}'")).await }
    };

    *env.policy.lock().unwrap() = Conflict::Ask;
    let b = engine.upload(sid.clone(), vec![q.to_string_lossy().into()], remote.clone());
    // Las 4 preguntas llegan sin bloquear: e.txt termina mientras tanto.
    let qs = wait_questions(&engine, &b, 4).await;
    assert_eq!(env.questions.lock().unwrap().iter().filter(|x| x.batch_id == b).count(), 4);
    let ok = wait_until(Duration::from_secs(30), || status_of(&engine, &b, "q/e.txt").0 == TransferStatus::Done).await;
    assert!(ok, "e.txt debía subirse sin esperar a las preguntas");
    let by_name = |n: &str| qs.iter().find(|x| x.name == n).unwrap().clone();
    let qa = by_name("q/a.txt");
    assert_eq!(qa.dest_size, Some(8));
    assert_eq!(qa.source_size, Some(7));
    assert!(qa.destination.ends_with("/q/a.txt"));
    assert_eq!(status_of(&engine, &b, "q/a.txt"), (TransferStatus::Queued, Some(ASK_MSG.into())));
    assert!(!engine.batch_finished(&b));

    // Una por una: a → sobrescribir, b → omitir, c → mantener ambos.
    engine.resolve(&qa.job_id, Conflict::Overwrite, false);
    engine.resolve(&by_name("q/b.txt").job_id, Conflict::Skip, false);
    engine.resolve(&by_name("q/c.txt").job_id, Conflict::Rename, false);
    // d → "solo si es más nuevo" para todo el lote (el remoto es más viejo: se sube).
    engine.resolve(&by_name("q/d.txt").job_id, Conflict::Newer, true);
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert!(engine.conflicts().is_empty());
    assert_eq!(status_of(&engine, &b, "q/a.txt").0, TransferStatus::Done);
    assert_eq!(status_of(&engine, &b, "q/b.txt").0, TransferStatus::Skipped);
    assert_eq!(status_of(&engine, &b, "q/c (2).txt").0, TransferStatus::Done);
    assert_eq!(status_of(&engine, &b, "q/d.txt").0, TransferStatus::Done);
    assert_eq!(cat("a.txt".into()).await, "local-a");
    assert_eq!(cat("b.txt".into()).await, "remoto-b");
    assert_eq!(cat("c.txt".into()).await, "remoto-c");
    assert_eq!(cat("c (2).txt".into()).await, "local-c");
    assert_eq!(cat("d.txt".into()).await, "local-d");

    // "Aplicar a todos" con preguntas pendientes: todas se responden de una vez.
    let b = engine.upload(sid.clone(), vec![q.to_string_lossy().into()], remote.clone());
    let qs = wait_questions(&engine, &b, 5).await;
    engine.resolve(&qs[0].job_id, Conflict::Skip, true);
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert!(batch_jobs(&engine, &b).iter().all(|j| j.status == TransferStatus::Skipped));
    let answered = env.answered.lock().unwrap().clone();
    assert!(qs.iter().all(|x| answered.contains(&x.job_id)));

    // Cancelar el lote descarta sus preguntas.
    let b = engine.upload(sid.clone(), vec![q.to_string_lossy().into()], remote.clone());
    let qs = wait_questions(&engine, &b, 5).await;
    engine.cancel(std::slice::from_ref(&b));
    assert!(engine.conflicts().is_empty());
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert!(batch_jobs(&engine, &b).iter().all(|j| j.status == TransferStatus::Canceled));
    let answered = env.answered.lock().unwrap().clone();
    assert!(qs.iter().all(|x| answered.contains(&x.job_id)));

    // Bajada con "mantener ambos": el archivo local existente no se toca.
    let dst = tmp_dir("ask-dst");
    std::fs::write(dst.join("a.txt"), "viejo").unwrap();
    let b = engine.download(sid.clone(), vec![format!("{remote}/q/a.txt")], dst.to_string_lossy().into());
    let qs = wait_questions(&engine, &b, 1).await;
    assert_eq!(qs[0].source_size, Some(7));
    assert_eq!(qs[0].dest_size, Some(5));
    engine.resolve(&qs[0].job_id, Conflict::Rename, false);
    wait_batch(&engine, &b, Duration::from_secs(30)).await;
    assert_all_done(&engine, &b);
    assert_eq!(std::fs::read_to_string(dst.join("a.txt")).unwrap(), "viejo");
    assert_eq!(std::fs::read_to_string(dst.join("a (2).txt")).unwrap(), "local-a");

    engine.clear_finished();
    remote_exec(&session, &format!("rm -rf {remote}")).await;
    std::fs::remove_dir_all(&src).ok();
    std::fs::remove_dir_all(&dst).ok();
}
