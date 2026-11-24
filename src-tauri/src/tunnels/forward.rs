//! Escucha local / SOCKS5 y enlace remoto (`tcpip_forward`) de los túneles SSH.

use std::net::SocketAddr;
use std::sync::{Arc, Weak};
use std::time::Duration;

use tokio::net::{TcpListener, TcpStream};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::ssh::SshSession;
use crate::tunnels::io::{pipe, Stats};
use crate::tunnels::manager::Sessions;
use crate::tunnels::remote::{self, Route, RouteKey};
use crate::tunnels::socks;
use crate::tunnels::types::{TunnelDef, TunnelKind};

const OPEN_TIMEOUT: Duration = Duration::from_secs(15);
const FORWARD_TIMEOUT: Duration = Duration::from_secs(10);
const SOCKS_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) struct RemoteBinding {
    pub key: RouteKey,
    pub session: Weak<SshSession>,
    pub bind_host: String,
    pub port: u32,
}

pub(super) async fn close_remote(rb: RemoteBinding) {
    remote::unregister(&rb.key);
    if let Some(s) = rb.session.upgrade()
        && !s.is_closed()
    {
        let fut = s.handle.cancel_tcpip_forward(rb.bind_host, rb.port);
        match tokio::time::timeout(Duration::from_secs(3), fut).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => log::debug!("cancel_tcpip_forward: {e}"),
            Err(_) => log::debug!("cancel_tcpip_forward: tiempo agotado"),
        }
    }
}

fn bind_error(host: &str, port: u16, e: Option<std::io::Error>) -> AppError {
    use std::io::ErrorKind;
    let Some(e) = e else {
        return AppError::Invalid(format!("No se reconoce la dirección «{host}» de tu PC"));
    };
    match e.kind() {
        ErrorKind::AddrInUse => AppError::Invalid(format!("El puerto {port} ya está en uso en tu PC")),
        ErrorKind::PermissionDenied => AppError::Invalid(if port < 1024 {
            format!(
                "No hay permiso para abrir el puerto {port} en tu PC: los puertos menores que 1024 \
                 necesitan permisos de administrador"
            )
        } else {
            format!("No hay permiso para abrir el puerto {port} en tu PC")
        }),
        ErrorKind::AddrNotAvailable => AppError::Invalid(format!("La dirección {host} no pertenece a tu PC")),
        _ => AppError::Io(format!("No se pudo abrir {host}:{port} en tu PC: {e}")),
    }
}

async fn bind_local(host: &str, port: u16) -> AppResult<TcpListener> {
    let addrs: Vec<SocketAddr> = match tokio::net::lookup_host((host, port)).await {
        Ok(a) => a.collect(),
        Err(e) => {
            return Err(AppError::Invalid(format!("No se reconoce la dirección «{host}» de tu PC: {e}")));
        }
    };
    let mut last = None;
    for a in addrs {
        match TcpListener::bind(a).await {
            Ok(l) => return Ok(l),
            Err(e) => last = Some(e),
        }
    }
    Err(bind_error(host, port, last))
}

struct ConnCtx {
    env: Sessions,
    session_id: String,
    def: TunnelDef,
    stats: Arc<Stats>,
    cancel: CancellationToken,
}

pub(super) async fn open_listener(
    env: &Sessions,
    session_id: &str,
    def: &TunnelDef,
    stats: Arc<Stats>,
    cancel: CancellationToken,
) -> AppResult<u16> {
    let listener = bind_local(&def.bind_host, def.bind_port).await?;
    let port = listener.local_addr().map(|a| a.port()).unwrap_or(def.bind_port);
    let ctx = Arc::new(ConnCtx {
        env: env.clone(),
        session_id: session_id.to_string(),
        def: def.clone(),
        stats,
        cancel,
    });
    tokio::spawn(accept_loop(listener, ctx));
    Ok(port)
}

async fn accept_loop(listener: TcpListener, ctx: Arc<ConnCtx>) {
    loop {
        let accepted = tokio::select! {
            _ = ctx.cancel.cancelled() => break,
            r = listener.accept() => r,
        };
        match accepted {
            Ok((tcp, peer)) => {
                let _ = tcp.set_nodelay(true);
                let ctx = ctx.clone();
                tokio::spawn(async move { handle_conn(&ctx, tcp, peer).await });
            }
            Err(e) => {
                ctx.stats.note_error(format!("Error al aceptar conexiones: {e}"));
                tokio::time::sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

fn describe_open_error(host: &str, port: u16, e: &russh::Error) -> (u8, String) {
    use russh::ChannelOpenFailure as F;
    match e {
        russh::Error::ChannelOpenFailure(F::AdministrativelyProhibited) => (
            socks::REP_NOT_ALLOWED,
            format!("El servidor no permite túneles hacia {host}:{port} (revisa AllowTcpForwarding)"),
        ),
        russh::Error::ChannelOpenFailure(F::ConnectFailed) => (
            socks::REP_REFUSED,
            format!("El servidor no pudo conectar con {host}:{port} (¿el servicio está apagado o el nombre es incorrecto?)"),
        ),
        russh::Error::ChannelOpenFailure(f) => (
            socks::REP_FAILURE,
            format!("El servidor rechazó el canal hacia {host}:{port} ({f:?})"),
        ),
        other => (
            socks::REP_FAILURE,
            format!("No se pudo abrir el canal hacia {host}:{port}: {other}"),
        ),
    }
}

async fn handle_conn(ctx: &ConnCtx, mut tcp: TcpStream, peer: SocketAddr) {
    let is_socks = ctx.def.kind == TunnelKind::Socks;
    let (host, port) = if is_socks {
        match tokio::time::timeout(SOCKS_TIMEOUT, socks::handshake(&mut tcp)).await {
            Ok(Ok(t)) => t,
            Ok(Err(e)) => {
                ctx.stats.note_error(e);
                return;
            }
            Err(_) => {
                ctx.stats.note_error("SOCKS: el programa no completó la negociación a tiempo".into());
                return;
            }
        }
    } else {
        (ctx.def.dest_host.clone(), ctx.def.dest_port)
    };
    async fn fail(is_socks: bool, tcp: &mut TcpStream, rep: u8) {
        if is_socks {
            let _ = socks::reply(tcp, rep).await;
        }
    }
    let session = match ctx.env.session(&ctx.session_id).await {
        Ok(s) => s,
        Err(_) => {
            fail(is_socks, &mut tcp, socks::REP_FAILURE).await;
            ctx.stats.note_error("Conexión rechazada: no hay conexión con el servidor".into());
            return;
        }
    };
    let open = session.handle.channel_open_direct_tcpip(host.clone(), u32::from(port), peer.ip().to_string(), u32::from(peer.port()));
    let channel = match tokio::time::timeout(OPEN_TIMEOUT, open).await {
        Ok(Ok(c)) => c,
        Ok(Err(e)) => {
            let (rep, msg) = describe_open_error(&host, port, &e);
            fail(is_socks, &mut tcp, rep).await;
            ctx.stats.note_error(msg);
            return;
        }
        Err(_) => {
            fail(is_socks, &mut tcp, socks::REP_HOST_UNREACHABLE).await;
            ctx.stats.note_error(format!("{host}:{port} no respondió a tiempo desde el servidor"));
            return;
        }
    };
    if is_socks && socks::reply(&mut tcp, socks::REP_OK).await.is_err() {
        return;
    }
    pipe(tcp, channel.into_stream(), ctx.stats.clone(), ctx.cancel.clone()).await;
}

pub(super) async fn open_remote(
    session: &Arc<SshSession>,
    def: &TunnelDef,
    port: u32,
    stats: Arc<Stats>,
    cancel: CancellationToken,
) -> AppResult<(u16, RemoteBinding)> {
    let fut = session.handle.tcpip_forward(def.bind_host.clone(), port);
    let got = match tokio::time::timeout(FORWARD_TIMEOUT, fut).await {
        Err(_) => return Err(AppError::Network("el servidor no respondió a la petición de abrir el puerto".into())),
        Ok(Err(russh::Error::RequestDenied)) => {
            let what = if port == 0 { "un puerto".to_string() } else { format!("el puerto {port}") };
            return Err(AppError::Invalid(format!(
                "El servidor no permitió abrir {what} en {}: puede que ya esté en uso allí, que sea \
                 menor que 1024 o que el servidor tenga desactivados los túneles (AllowTcpForwarding)",
                def.bind_host
            )));
        }
        Ok(Err(e)) => return Err(e.into()),
        Ok(Ok(p)) => p,
    };
    let bound = if port != 0 { port } else { got };
    let key = RouteKey::new(&session.info.host, session.info.port, bound);
    remote::register(
        key.clone(),
        Route { dest_host: def.dest_host.clone(), dest_port: def.dest_port, stats, cancel },
    );
    Ok((
        u16::try_from(bound).unwrap_or(0),
        RemoteBinding { key, session: Arc::downgrade(session), bind_host: def.bind_host.clone(), port: bound },
    ))
}
