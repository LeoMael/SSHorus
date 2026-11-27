//! `deploy_app`: de lo que pide la IA a un `AppSpec` validado (una sola forma de arrancar, rutas y valores
//! comprobados con `deploy::check`). Sin conexión: se rechaza antes de preguntar nada.

use super::super::deploy::app_script::{AppSpec, ImageSource, Run};
use super::super::deploy::check;
use super::deploy::DeployAppParams;

/// Lo que pide la IA → `AppSpec` validado.
pub(super) fn spec_from(
    p: &DeployAppParams,
    user: String,
    name: String,
) -> Result<AppSpec, String> {
    let some = |o: &Option<String>| {
        o.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let (image, archive, exec) = (some(&p.image), some(&p.image_archive), some(&p.exec_start));
    let copy_from = some(&p.copy_from)
        .map(|c| check::server_path(&c, "copy_from"))
        .transpose()?;
    let run = match (image, exec) {
        (Some(_), Some(_)) => {
            return Err("Usa image (contenedor) o exec_start (programa), no los dos.".into());
        }
        (None, Some(cmd)) => {
            if p.build || archive.is_some() {
                return Err(
                    "build e image_archive son para contenedores: quita exec_start o usa image."
                        .into(),
                );
            }
            Run::Program(check::exec_start(&cmd, &name)?)
        }
        (image, None) => {
            let source = match (p.build, archive) {
                (true, Some(_)) => return Err("Usa build o image_archive, no los dos.".into()),
                (true, None) if copy_from.is_none() => {
                    return Err(
                        "build necesita copy_from (la carpeta con el código y el Containerfile)."
                            .into(),
                    );
                }
                (true, None) => ImageSource::Build,
                (false, Some(f)) => ImageSource::Archive(check::server_path(&f, "image_archive")?),
                (false, None) => ImageSource::Pull,
            };
            let image = match image {
                Some(i) => check::image(&i)?,
                None if source == ImageSource::Build => format!("localhost/{name}:latest"),
                None => {
                    return Err(
                        "Falta image (la imagen del contenedor) o exec_start (un programa).".into(),
                    );
                }
            };
            Run::Container { image, source }
        }
    };
    let program = matches!(run, Run::Program(_));
    check::env(&p.env, program)?;
    let volumes = p
        .volumes
        .iter()
        .map(|v| check::volume(v))
        .collect::<Result<Vec<_>, _>>()?;
    if program && !volumes.is_empty() {
        return Err(
            "volumes es para contenedores: un programa ya guarda sus datos en ~/apps/<name>."
                .into(),
        );
    }
    Ok(AppSpec {
        user,
        name,
        run,
        port: p.port.map(check::port).transpose()?,
        container_port: p.container_port.map(check::port).transpose()?,
        public: p.public,
        env: p.env.clone(),
        volumes,
        copy_from,
    })
}
