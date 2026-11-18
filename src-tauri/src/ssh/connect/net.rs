//! Red: abrir TCP (con DNS y plazo) y traducir los fallos de red y de negociación SSH.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use tokio::net::TcpStream;

use super::TCP_TIMEOUT;
use crate::error::{AppError, AppResult};
use crate::ssh::handler::{HostKeyVerdict, SharedState};

pub(super) async fn tcp_connect(host: &str, port: u16) -> AppResult<TcpStream> {
    let fut = async {
        let addrs: Vec<SocketAddr> = match tokio::net::lookup_host((host, port)).await {
            Ok(a) => a.collect(),
            Err(e) => {
                log::debug!("DNS {host}: {e}");
                return Err(AppError::Network(format!(
                    "No se encontró el servidor «{host}». Revisa el nombre o tu conexión a internet"
                )));
            }
        };
        if addrs.is_empty() {
            return Err(AppError::Network(format!(
                "No se encontró el servidor «{host}»"
            )));
        }
        let mut last: Option<std::io::Error> = None;
        for addr in &addrs {
            match TcpStream::connect(addr).await {
                Ok(s) => return Ok(s),
                Err(e) => last = Some(e),
            }
        }
        Err(io_connect_error(host, port, last))
    };
    match tokio::time::timeout(TCP_TIMEOUT, fut).await {
        Ok(r) => r,
        Err(_) => Err(AppError::Network(format!(
            "Tiempo de espera agotado al conectar con {host}:{port} (el servidor no responde o un cortafuegos bloquea el puerto)"
        ))),
    }
}

fn io_connect_error(host: &str, port: u16, e: Option<std::io::Error>) -> AppError {
    use std::io::ErrorKind::*;
    let Some(e) = e else {
        return AppError::Network(format!("No se pudo conectar con {host}:{port}"));
    };
    let msg = match e.kind() {
        ConnectionRefused => format!(
            "{host} rechazó la conexión en el puerto {port} (¿está activo el servicio SSH y el puerto es correcto?)"
        ),
        TimedOut => format!("Tiempo de espera agotado al conectar con {host}:{port}"),
        HostUnreachable | NetworkUnreachable => {
            format!("No hay ruta hasta {host} (revisa tu red o VPN)")
        }
        PermissionDenied => format!("El sistema no permitió conectar con {host}:{port}"),
        _ => format!("No se pudo conectar con {host}:{port}: {e}"),
    };
    AppError::Network(msg)
}

pub(super) fn handshake_error(
    shared: &Arc<Mutex<SharedState>>,
    host: &str,
    port: u16,
    e: russh::Error,
) -> AppError {
    let verdict = shared.lock().ok().and_then(|s| s.verdict.clone());
    match verdict {
        Some(HostKeyVerdict::Unknown(info)) => return AppError::HostKeyUnknown(info),
        Some(HostKeyVerdict::Changed(info)) => return AppError::HostKeyChanged(info),
        Some(HostKeyVerdict::Error(msg)) => return AppError::Io(msg),
        _ => {}
    }
    log::warn!("negociación SSH con {host}:{port} falló: {e:?}");
    match e {
        russh::Error::Version => AppError::Network(format!(
            "{host}:{port} no parece un servidor SSH"
        )),
        russh::Error::NoCommonAlgo { kind, .. } => AppError::Ssh(format!(
            "El servidor no tiene algoritmos compatibles ({kind:?})"
        )),
        russh::Error::HUP | russh::Error::Disconnect | russh::Error::IO(_) => {
            AppError::Network(format!(
                "{host}:{port} cerró la conexión durante la negociación SSH"
            ))
        }
        other => AppError::Ssh(format!("Falló la negociación SSH: {other}")),
    }
}
