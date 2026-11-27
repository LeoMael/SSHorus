//! Lo que se despliega con `deploy_app` (`AppSpec`, ya validado con `check`) y los archivos que salen de ahí:
//! la unidad systemd del usuario, el archivo de variables y el resumen para el diálogo de permiso.

use std::collections::BTreeMap;

/// De dónde sale la imagen del contenedor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ImageSource {
    Pull,
    /// `podman build` en la carpeta de la app (Containerfile o Dockerfile).
    Build,
    /// `podman load` de un archivo subido (p. ej. `podman save` en el PC).
    Archive(String),
}

/// Qué se arranca.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Run {
    Container {
        image: String,
        source: ImageSource,
    },
    /// Orden de arranque ya validada (`check::exec_start`).
    Program(String),
}

/// Todo lo que hace falta, ya validado con `check`.
#[derive(Debug, Clone)]
pub struct AppSpec {
    pub user: String,
    pub name: String,
    pub run: Run,
    /// Puerto del servidor donde escucha la app.
    pub port: Option<u16>,
    /// Puerto dentro del contenedor (por defecto, el mismo).
    pub container_port: Option<u16>,
    /// Publicar en todas las interfaces (solo para desplegar con IP:puerto, sin proxy).
    pub public: bool,
    pub env: BTreeMap<String, String>,
    /// (subcarpeta de la app, ruta en el contenedor).
    pub volumes: Vec<(String, String)>,
    pub copy_from: Option<String>,
}

impl AppSpec {
    pub fn unit_name(&self) -> String {
        format!("{}.service", self.name)
    }

    fn env_file(&self) -> String {
        format!("%h/.config/sshorus/{}.env", self.name)
    }

    /// Líneas de la unidad systemd de usuario. `%h` (carpeta del usuario), `%t` y `%n` son de systemd.
    pub fn unit_lines(&self) -> Vec<String> {
        let mut l = vec![
            "# Creado por SSHorus (deploy_app)".to_string(),
            "[Unit]".into(),
            format!("Description={} (desplegado con SSHorus)", self.name),
            String::new(),
            "[Service]".into(),
        ];
        match &self.run {
            Run::Container { image, .. } => {
                let mut run = vec![
                    "podman run --cidfile=%t/%n.ctr-id --cgroups=no-conmon --rm --sdnotify=conmon --replace -d".to_string(),
                    format!("--name {}", self.name),
                    format!("--env-file={}", self.env_file()),
                ];
                if let Some(p) = self.port {
                    let inner = self.container_port.unwrap_or(p);
                    run.push(if self.public {
                        format!("-p {p}:{inner}")
                    } else {
                        format!("-p 127.0.0.1:{p}:{inner}")
                    });
                }
                for (dir, target) in &self.volumes {
                    run.push(format!("-v %h/apps/{}/{dir}:{target}:Z", self.name));
                }
                run.push(image.clone());
                l.extend([
                    "Environment=PODMAN_SYSTEMD_UNIT=%n".into(),
                    "Type=notify".into(),
                    "NotifyAccess=all".into(),
                    "TimeoutStartSec=300".into(),
                    "TimeoutStopSec=70".into(),
                    format!("ExecStart={}", run.join(" ")),
                    "ExecStop=podman stop --ignore -t 10 --cidfile=%t/%n.ctr-id".into(),
                    "ExecStopPost=podman rm -f --ignore --cidfile=%t/%n.ctr-id".into(),
                ]);
            }
            Run::Program(cmd) => l.extend([
                format!("WorkingDirectory=%h/apps/{}", self.name),
                format!("EnvironmentFile=-{}", self.env_file()),
                format!("ExecStart={cmd}"),
            ]),
        }
        l.extend([
            "Restart=on-failure".into(),
            "RestartSec=5".into(),
            String::new(),
            "[Install]".into(),
            "WantedBy=default.target".into(),
        ]);
        l
    }

    /// Líneas del archivo de variables (podman: literal; systemd: entre comillas simples).
    pub fn env_lines(&self) -> Vec<String> {
        let container = matches!(self.run, Run::Container { .. });
        self.env
            .iter()
            .map(|(k, v)| {
                if container {
                    format!("{k}={v}")
                } else {
                    format!("{k}='{v}'")
                }
            })
            .collect()
    }

    /// Resumen para el diálogo de permiso (sin valores de las variables).
    pub fn describe(&self) -> String {
        let mut out = vec![
            format!("Usuario de la app: {} (sin sudo)", self.user),
            format!(
                "Servicio de ese usuario: {} (arranca solo al iniciar el servidor)",
                self.unit_name()
            ),
        ];
        out.push(match &self.run {
            Run::Container {
                image,
                source: ImageSource::Pull,
            } => format!("Contenedor Podman sin root con la imagen {image} (se descarga)"),
            Run::Container {
                image,
                source: ImageSource::Build,
            } => format!(
                "Contenedor Podman sin root: se construye {image} en ~/apps/{}",
                self.name
            ),
            Run::Container {
                image,
                source: ImageSource::Archive(f),
            } => format!("Contenedor Podman sin root: se carga {image} desde {f}"),
            Run::Program(cmd) => format!("Programa: {}", cmd.replace("%%", "%")),
        });
        if let Some(p) = self.port {
            let inner = self
                .container_port
                .filter(|_| matches!(self.run, Run::Container { .. }));
            let to = inner
                .map(|i| format!(" → {i} del contenedor"))
                .unwrap_or_default();
            out.push(if self.public {
                format!("Puerto: {p}{to} en TODAS las interfaces (accesible desde Internet si el cortafuegos lo deja)")
            } else {
                format!("Puerto: 127.0.0.1:{p}{to} (solo local, para Caddy o nginx)")
            });
        }
        if let Some(src) = &self.copy_from {
            out.push(format!("Copia {src} → ~/apps/{}/", self.name));
        }
        if !self.env.is_empty() {
            let keys: Vec<&str> = self.env.keys().map(String::as_str).collect();
            out.push(format!(
                "Variables: {} (en ~/.config/sshorus/{}.env, solo legible por {})",
                keys.join(", "),
                self.name,
                self.user
            ));
        }
        for (dir, target) in &self.volumes {
            out.push(format!("Volumen: ~/apps/{}/{dir} → {target}", self.name));
        }
        out.join("\n")
    }
}
