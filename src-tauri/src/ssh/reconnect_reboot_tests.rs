//! Reconexión tras un reinicio pedido por el usuario (`reboot_wait`), contra el servidor de pruebas.
//! Ejecutar: `cargo test --lib ssh::reconnect -- --ignored --test-threads=1`
//! El que reinicia el contenedor solo corre con `SSHORUS_PODMAN_TESTS=1`.

use super::*;

/// Con el reinicio avisado se reconecta aunque la reconexión automática esté desactivada.
#[tokio::test]
#[ignore]
async fn expected_reboot_reconnects_even_with_auto_reconnect_off() {
    let env = TestEnv::new(false, 1);
    let (s, task) = start(&env, fast_timing(300), None, HostKeyPolicy::AcceptAny).await;
    let id = s.info.id.clone();
    reboot_wait::expect(&id, Duration::from_secs(30));
    kill_connection(&s).await;
    wait_until("reconexión", 30, || !env.reconnected().is_empty()).await;
    assert_eq!(env.reconnected()[0].id, id);
    let r = &env.reconnecting()[0];
    assert!(
        r.max_attempts > 1,
        "en modo reinicio hay más intentos: {r:?}"
    );
    assert!(r.reason.contains("reinicio"), "{}", r.reason);
    assert!(
        reboot_wait::take(&id).is_none(),
        "el aviso se consume con la caída"
    );

    // La siguiente caída ya es normal: con la reconexión automática desactivada, se cierra.
    let new = env.store.get(&id).await.expect("sesión");
    kill_connection(&new).await;
    wait_until("cierre", 15, || !env.closed().is_empty()).await;
    tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap();
}

/// Si el servidor no vuelve antes del plazo, se rinde con un motivo claro.
#[tokio::test]
#[ignore]
async fn expected_reboot_gives_up_at_the_deadline() {
    let env = TestEnv::new(true, 20);
    let (s, task) = start(&env, fast_timing(300), Some(1), HostKeyPolicy::AcceptAny).await;
    let id = s.info.id.clone();
    reboot_wait::expect(&id, Duration::from_secs(2));
    kill_connection(&s).await;
    wait_until("abandono", 20, || !env.closed().is_empty()).await;
    tokio::time::timeout(Duration::from_secs(3), task)
        .await
        .unwrap()
        .unwrap();
    let c = &env.closed()[0];
    assert!(
        c.reason.starts_with("El servidor no volvió a tiempo"),
        "{}",
        c.reason
    );
    assert!(
        env.reconnecting().len() < 20,
        "corta por el plazo, no por los intentos"
    );
}

/// Reinicio del contenedor con el aviso puesto: vuelve con el mismo id.
#[tokio::test]
#[ignore]
async fn expected_reboot_survives_container_restart() {
    if std::env::var("SSHORUS_PODMAN_TESTS").ok().as_deref() != Some("1") {
        eprintln!("omitido: define SSHORUS_PODMAN_TESTS=1 (reinicia el contenedor de pruebas)");
        return;
    }
    let _guard = StartOnDrop;
    let env = TestEnv::new(false, 1);
    let (s, task) = start(&env, fast_timing(1000), None, HostKeyPolicy::AcceptAny).await;
    let id = s.info.id.clone();
    reboot_wait::expect(&id, Duration::from_secs(120));
    assert!(podman(&["restart", "-t", "1", "terview-sshd"]));
    wait_until("reconexión tras reiniciar", 120, || {
        !env.reconnected().is_empty()
    })
    .await;
    assert_eq!(env.reconnected()[0].id, id);
    assert!(env.closed().is_empty());
    finish(&env, &id, task).await;
}
