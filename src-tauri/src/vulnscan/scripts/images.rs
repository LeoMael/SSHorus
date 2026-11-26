//! Fase 4: imágenes y contenedores de cada motor, leídos como el dueño del almacén (sin arrancar
//! nada), y «Actualizar imagen» como ese mismo usuario.

use serde::{Deserialize, Serialize};

use super::super::model::Engine;
use super::{sh_quote, PATH_LINE, RPM_QF, TRIVY_TEMPLATE};

/// Usuario dueño de un almacén de contenedores (para entrar como él con `runuser`/`sudo -u`/`su`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserCtx {
    pub name: String,
    pub uid: u32,
    pub home: String,
}

fn valid_user(u: &UserCtx) -> bool {
    !u.name.is_empty()
        && u.name.len() <= 32
        && u.name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        && !u.name.starts_with('-')
        && u.home.starts_with('/')
        && !u.home.contains(['\n', '\0'])
}

/// Carpeta de ejecución propia (XDG_RUNTIME_DIR) cuando el usuario no tiene /run/user/<uid> (sin sesión
/// ni linger). Sin ella, Podman 3.x/4.x cae al RunRoot de root (/run/containers/storage) y falla con
/// «permission denied». Se crea ya como el usuario, con modo 700; si existe y no es suya (otro la creó
/// antes en /tmp), no se usa. Una sola línea, la misma que muestra la interfaz (`runtimeFallback` en
/// src/features/containers/owner.ts).
pub fn runtime_fallback(uid: u32) -> String {
    format!(
        r#"d="${{TMPDIR:-/tmp}}/sshorus-run-{uid}"; mkdir -p -m 700 "$d" 2>/dev/null; if [ -L "$d" ] || [ "$(stat -c %u:%a "$d" 2>/dev/null)" != {uid}:700 ]; then echo "La carpeta $d no es de este usuario o no tiene permisos 700: bórrala o usa otro TMPDIR" >&2; exit 1; fi; export XDG_RUNTIME_DIR="$d""#
    )
}

/// Lo que se ejecuta ya como el usuario `uid`: elige su XDG_RUNTIME_DIR y luego `prefix` + `inner`.
pub(crate) fn as_user_script(uid: u32, prefix: &str, inner: &str) -> String {
    format!(
        "r=/run/user/{uid}\n\
         if [ -d \"$r\" ] && [ \"$(stat -c %u \"$r\" 2>/dev/null)\" = {uid} ]; then export XDG_RUNTIME_DIR=\"$r\"\n\
         else {fallback}; fi\n\
         {prefix} {inner}",
        fallback = runtime_fallback(uid),
        inner = sh_quote(inner),
    )
}

/// Ejecuta `inner` (texto de un script) con el shell. Si `user` es otro usuario (estamos como root),
/// se entra como él con `runuser -u` (util-linux), `sudo -u -H` o `su -s /bin/sh` (busybox), con su
/// HOME (sin él, Podman busca el almacén en el de root) y su XDG_RUNTIME_DIR: /run/user/<uid> si existe
/// y es suyo, o una carpeta propia en /tmp (`runtime_fallback`). Ya como él se decide cuál.
/// `unshare` = envolver en `podman unshare` (para montar imágenes sin ser root).
fn run_as(user: Option<&UserCtx>, unshare: bool, inner: &str) -> String {
    let prefix = if unshare { "podman unshare sh -c" } else { "sh -c" };
    let Some(u) = user.filter(|u| valid_user(u)) else {
        return format!("TV_INNER={}\n{prefix} \"$TV_INNER\"", sh_quote(inner));
    };
    let as_user = as_user_script(u.uid, prefix, inner);
    format!(
        r#"TV_INNER={as_user}
export TV_INNER
cd / 2>/dev/null
if command -v runuser >/dev/null 2>&1; then
  runuser -u {name} -- env -u XDG_RUNTIME_DIR HOME={home} sh -c "$TV_INNER"
elif command -v sudo >/dev/null 2>&1; then
  sudo -u {name} -H env -u XDG_RUNTIME_DIR HOME={home} sh -c "$TV_INNER"
else
  su -s /bin/sh {name} -c "HOME={home_inner}; export HOME; sh -c \"\$TV_INNER\""
fi"#,
        as_user = sh_quote(&as_user),
        name = sh_quote(&u.name),
        home = sh_quote(&u.home),
        home_inner = u.home.replace(['"', '$', '`', '\\'], ""),
    )
}

/// Fase 4a: imágenes y contenedores de un motor (de un usuario, o del conectado / de root).
/// `@@images`: id corto, repositorio:etiqueta. `@@containers`: id, nombre, id de imagen, estado.
pub fn images_list_script(engine: Engine, user: Option<&UserCtx>) -> String {
    let inner = match engine {
        Engine::Podman => "echo @@images\n\
             podman images --format '{{.ID}}\t{{.Repository}}:{{.Tag}}' 2>&1\n\
             echo @@containers\n\
             podman ps -a --format '{{.ID}}\t{{.Names}}\t{{.ImageID}}\t{{.State}}' 2>&1\n\
             echo @@end"
            .to_string(),
        Engine::Docker => {
            let host = docker_host(user);
            format!(
                "{host}echo @@images\n\
                 docker images --no-trunc --format '{{{{.ID}}}}\t{{{{.Repository}}}}:{{{{.Tag}}}}' 2>&1\n\
                 echo @@containers\n\
                 docker ps -aq --no-trunc 2>/dev/null | xargs -r docker inspect --format '{{{{.Id}}}}\t{{{{.Name}}}}\t{{{{.Image}}}}\t{{{{.State.Status}}}}' 2>&1\n\
                 echo @@end"
            )
        }
    };
    let body = match engine {
        // Docker de otro usuario: su demonio rootless, por su socket (no hace falta entrar como él).
        Engine::Docker => format!("sh -c {}", sh_quote(&inner)),
        Engine::Podman => run_as(user, false, &inner),
    };
    format!("{PATH_LINE}\n{body}\n")
}

/// «Actualizar imagen» (lo único del escáner que cambia algo, y solo tras confirmar en la interfaz):
/// ejecuta `inner` (los comandos ya citados que se le mostraron al usuario) como el dueño de la imagen.
/// - `user` = None: tal cual (el usuario conectado, o root si la interfaz eleva).
/// - Podman de otro usuario: se entra como él igual que al analizar (`run_as`: su HOME y su
///   XDG_RUNTIME_DIR, necesario también para `systemctl --user`).
/// - Docker rootless de otro usuario: su demonio, por su socket (como al analizar).
///
/// Si el usuario no es válido no se ejecuta nada (nunca se cae a root por error). Sale con el código de `inner`.
pub fn as_owner_script(engine: Engine, user: Option<&UserCtx>, inner: &str) -> String {
    let inner = format!("{PATH_LINE}\n{inner}");
    let body = match user {
        None => inner,
        Some(u) if !valid_user(u) => "echo 'Usuario no válido' >&2\nexit 1".to_string(),
        Some(u) => match engine {
            Engine::Podman => run_as(Some(u), false, &inner),
            Engine::Docker => format!(
                "s=/run/user/{uid}/docker.sock\n\
                 if [ ! -S \"$s\" ]; then echo 'Docker rootless de este usuario: su demonio está parado' >&2; exit 1; fi\n\
                 DOCKER_HOST=unix://$s; export DOCKER_HOST\n\
                 sh -c {}",
                sh_quote(&inner),
                uid = u.uid
            ),
        },
    };
    format!("{PATH_LINE}\n{body}\n")
}

/// Docker rootless de otro usuario: su socket en /run/user/<uid>.
fn docker_host(user: Option<&UserCtx>) -> String {
    match user.filter(|u| valid_user(u)) {
        Some(u) => format!(
            "s=/run/user/{uid}/docker.sock\n\
             if [ ! -S \"$s\" ]; then echo '@@error Docker rootless de este usuario: demonio parado'; echo @@end; exit 0; fi\n\
             DOCKER_HOST=unix://$s; export DOCKER_HOST\n",
            uid = u.uid
        ),
        None => String::new(),
    }
}

/// Lectura de la base de paquetes dentro de `$m` (raíz de la imagen montada o copiada).
fn read_pkgdb() -> String {
    format!(
        r#"rd() {{ f="$m/$1"; i=0
  while [ -L "$f" ] && [ $i -lt 8 ]; do l=$(readlink "$f"); case $l in /*) f="$m$l" ;; *) f="$(dirname "$f")/$l" ;; esac; i=$((i+1)); done
  cat "$f" 2>/dev/null; }}
echo @@os; rd usr/lib/os-release || rd etc/os-release
if [ -s "$m/var/lib/dpkg/status" ] || [ -d "$m/var/lib/dpkg/status.d" ]; then
  echo @@dpkgstatus
  {{ cat "$m/var/lib/dpkg/status" 2>/dev/null; for f in "$m"/var/lib/dpkg/status.d/*; do [ -f "$f" ] && {{ cat "$f"; echo; }}; done; }} | grep -E '^(Package|Status|Version|Source|Architecture):|^$'
elif [ -s "$m/lib/apk/db/installed" ]; then
  echo @@apkdb; grep -E '^[PVoA]:|^$' "$m/lib/apk/db/installed"
elif [ -e "$m/var/lib/rpm" ] || [ -e "$m/usr/lib/sysimage/rpm" ]; then
  db="$m/usr/lib/sysimage/rpm"
  [ -e "$db/rpmdb.sqlite" ] || [ -e "$db/Packages" ] || [ -e "$db/Packages.db" ] || db="$m/var/lib/rpm"
  if command -v rpm >/dev/null 2>&1; then echo "@@method rpm --dbpath"; echo @@rpm; rpm --dbpath "$db" -qa --qf '{RPM_QF}' 2>/dev/null
  else echo @@needrpm; fi
else echo @@nopkgdb; fi"#
    )
}

/// Fase 4b: paquetes de una imagen sin arrancar sus servicios (ver PENDIENTES 10.5).
///
/// - Podman: `podman image mount` (dentro de `podman unshare` si no es root) y se lee la base de
///   paquetes como archivos; RPM con el `rpm` del anfitrión (`--dbpath`). Si el anfitrión no tiene `rpm`,
///   se ejecuta SOLO el `rpm` de la imagen, sin red (`podman run --network=none --entrypoint rpm`).
/// - Docker: `docker create` (no arranca nada) + `docker cp` de los archivos + `docker rm`.
/// - `trivy` = usar Trivy si está (sobre la imagen montada o con `trivy image` en Docker).
pub fn image_script(engine: Engine, user: Option<&UserCtx>, image_id: &str, trivy: bool) -> String {
    let id: String = image_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == ':').collect();
    let id = id.trim_start_matches("sha256:").to_string();
    let q_tpl = sh_quote(TRIVY_TEMPLATE);
    let trivy_flag = if trivy { 1 } else { 0 };
    match engine {
        Engine::Podman => {
            let inner = format!(
                r#"img={id}
m=$(podman image mount "$img" 2>&1) || {{ echo "@@error no se pudo montar la imagen: $m"; echo @@end; exit 0; }}
echo "@@method montada"
if [ {trivy_flag} = 1 ] && command -v trivy >/dev/null 2>&1; then
  echo @@os; cat "$m/usr/lib/os-release" 2>/dev/null || cat "$m/etc/os-release" 2>/dev/null
  echo @@trivyver; trivy --version 2>/dev/null | head -n1
  echo @@trivy; trivy rootfs --quiet --scanners vuln --format template --template {q_tpl} "$m" 2>/dev/null; echo "@@rc $?"
else
{pkgdb}
fi
podman image unmount "$img" >/dev/null 2>&1
echo @@end"#,
                pkgdb = read_pkgdb(),
            );
            // Como root no hace falta `podman unshare`; como usuario sí («must execute podman unshare first»).
            let mount = run_as(user, true, &inner);
            let mount_root = run_as(None, false, &inner);
            let fallback = run_as(
                user,
                false,
                &format!(
                    "echo '@@method rpm de la imagen'; echo @@rpm; podman run --rm --network=none --entrypoint rpm {id} -qa --qf '{RPM_QF}' 2>/dev/null; echo @@end"
                ),
            );
            let mount_cmd = if user.is_none() {
                format!("if [ \"$(id -u)\" = 0 ]; then\n{mount_root}\nelse\n{mount}\nfi")
            } else {
                mount
            };
            format!(
                "{PATH_LINE}\nout=$(\n{mount_cmd}\n)\nprintf '%s\\n' \"$out\"\ncase $out in *@@needrpm*)\n{fallback}\n;; esac\n"
            )
        }
        Engine::Docker => {
            let host = docker_host(user);
            format!(
                r#"{PATH_LINE}
{host}img={id}
if [ {trivy_flag} = 1 ] && command -v trivy >/dev/null 2>&1; then
  c=$(docker create --entrypoint /bin/true "$img" 2>/dev/null) && {{ m=$(mktemp -d); for f in usr/lib/os-release etc/os-release; do docker cp "$c:/$f" - 2>/dev/null | tar -xOf - 2>/dev/null && break; done > "$m/os"; echo @@os; cat "$m/os"; rm -rf "$m"; docker rm "$c" >/dev/null 2>&1; }}
  echo "@@method trivy image"
  echo @@trivyver; trivy --version 2>/dev/null | head -n1
  echo @@trivy; trivy image --quiet --scanners vuln --format template --template {q_tpl} "$img" 2>/dev/null; echo "@@rc $?"
  echo @@end; exit 0
fi
c=$(docker create --entrypoint /bin/true "$img" 2>&1) || {{ echo "@@error no se pudo preparar la imagen: $c"; echo @@end; exit 0; }}
m=$(mktemp -d)
get() {{ mkdir -p "$m/$(dirname "$1")"; docker cp "$c:/$1" - 2>/dev/null | tar -xf - -C "$m/$(dirname "$1")" 2>/dev/null; }}
for f in usr/lib/os-release etc/os-release var/lib/dpkg/status var/lib/dpkg/status.d lib/apk/db/installed usr/lib/sysimage/rpm var/lib/rpm; do get "$f"; done
echo "@@method docker cp"
{pkgdb}
rm -rf "$m"
docker rm "$c" >/dev/null 2>&1
echo @@end
"#,
                pkgdb = read_pkgdb().replace(
                    "else echo @@needrpm; fi",
                    &format!(
                        "else echo '@@method rpm de la imagen'; echo @@rpm; docker run --rm --network=none --entrypoint rpm \"$img\" -qa --qf '{RPM_QF}' 2>/dev/null; fi"
                    )
                ),
            )
        }
    }
}
