//! La receta de despliegue que devuelve `get_deploy_guide`. Texto para la IA, en español: qué preguntar,
//! qué comprobar, qué herramienta usar en cada paso, cómo comprobarlo y cómo deshacerlo.

pub const DEPLOY_GUIDE: &str = r#"# Receta: desplegar un proyecto en un servidor con SSHorus

Sigue los pasos en orden, de uno en uno, y cuéntale al usuario qué vas a hacer antes de cada cambio. Cada cambio
muestra un diálogo en SSHorus con lo que se va a ejecutar: el usuario lo acepta o lo rechaza. Nunca pidas
contraseñas ni las pongas en comandos: SSHorus pone la de sudo por ti.

## 0. Preguntas al usuario (antes de tocar nada)
- Qué proyecto (carpeta de este PC) y en qué servidor (list_servers; get_infra_map para ver qué hay ya).
- ¿Con dominio (app.ejemplo.com) o solo con IP:puerto? Con dominio hay HTTPS automático; con IP, no.
- En qué puerto escucha la app y si necesita variables (claves de API, URL de la base de datos…). Los
  secretos de la app los da el usuario o los generas tú; nunca uses contraseñas guardadas en SSHorus.
- ¿Contenedor (hay Containerfile/Dockerfile o imagen publicada) o programa (binario, node, python…)?
  Prefiere contenedor si el proyecto ya lo trae.
- Nombre corto para la app (p. ej. «blog»): será el usuario, el servicio y la carpeta.

## 1. Comprobaciones previas (solo leen)
- list_servers: el nivel de acceso. Con «Solo lo marcado» hacen falta las tareas: users-create
  (create_app_user), containers o services (deploy_app), web (sitio), files (subir, en la carpeta permitida)
  y firewall (abrir puertos). Si falta alguna, pídele al usuario que la marque (plantilla «Despliegue»).
- connect si no hay conexión. Sistema y recursos con comandos 📊 de run_catalog_command (list_catalog,
  categoría «Análisis del sistema»: no piden permiso) o run_command: `cat /etc/os-release; nproc; free -m; df -h /`.
- Programas: run_command `command -v podman caddy nginx systemctl; podman --version; getenforce 2>/dev/null`.
  Sin Podman (y si quieres contenedor): instálalo con el catálogo «Paquetes» o run_command con sudo.
  Debian/Ubuntu: además `dbus-user-session` y `uidmap` para Podman sin root.
- list_ports: que el puerto de la app esté libre y quién ocupa el 80/443. list_sites: sitios que ya existen.
- Dominio: check_dns {server, domain}. Si no apunta aquí, dile al usuario el registro exacto que debe crear
  y sigue con IP:puerto mientras tanto.

## 2. Usuario aparte para la app
create_app_user {server, user: "<app>"} → usuario sin sudo y sin contraseña, con linger, subuid/subgid y
`~/apps`. Opcional public_key si el usuario quiere entrar por SSH con él.
- Comprobar: deploy_status {server, user}.
- Deshacer: deploy_app remove=true; run_command `sudo loginctl disable-linger <app>; sudo loginctl
  terminate-user <app>` (si no, userdel falla porque su systemd sigue en marcha); y run_catalog_command
  «usuarios.borrar-usuario-y-carpeta» {usuario}.

## 3. Código
Lo mejor es compilar en este PC (no carga el servidor): un binario, o una imagen con
`podman build -t localhost/<app>:latest . && podman save -o <app>.tar localhost/<app>:latest`.
Sube con upload a una carpeta del usuario conectado, p. ej. `~/sshorus-deploy/<app>/` (con «Solo lo marcado»,
dentro de las carpetas permitidas). No subas .git, node_modules, target/ ni archivos .env con secretos.
Si hay que construir en el servidor, sube el código fuente y usa deploy_app con build=true.

## 4. Arrancar la app (servicio del usuario de la app)
deploy_app {server, user, name, port, ...} con UNA de estas formas:
- Imagen publicada: image="docker.io/org/app:1.2" (se descarga).
- Imagen hecha en el PC: image="localhost/<app>:latest", image_archive="/home/<tú>/sshorus-deploy/<app>.tar".
- Construir en el servidor: copy_from="<carpeta subida>", build=true (usa Containerfile o Dockerfile).
- Programa: copy_from="<carpeta subida>", exec_start="./bin/app --port 8080" (relativo a ~/apps/<app>).
Por defecto escucha solo en 127.0.0.1:<port> (para Caddy/nginx). public=true solo para desplegar con
IP:puerto, y entonces abre ese puerto en el cortafuegos. container_port si dentro del contenedor es otro.
env para variables; volumes ["data:/var/lib/app"] para datos que deben sobrevivir.
Volver a llamarlo con lo nuevo = actualizar.
- Comprobar: deploy_status {server, user, port}. Si falla, deploy_app ya devuelve los últimos logs; más:
  run_command `sudo journalctl _UID=$(id -u <app>) -n 100 --no-pager`.
- Deshacer: deploy_app {server, user, name, remove: true} (para el servicio y quita su unidad; deja ~/apps/<app>).

## 5. Web (dominio y HTTPS)
- Caddy (recomendado: HTTPS automático): run_catalog_command «web.caddy-crear-sitio» {dominio, puerto}.
- nginx (solo HTTP): «web.nginx-crear-sitio» {dominio, puerto}; HTTPS después con run_command
  `sudo certbot --nginx -d <dominio>` si certbot está instalado.
- Hacen falta los puertos 80 y 443 abiertos: catálogo «Red» → «Abrir puerto» (firewalld o ufw).
- SELinux (Rocky, Alma, Fedora): si el sitio da 502, run_command `sudo setsebool -P httpd_can_network_connect 1`.
- Solo IP: sin sitio; deploy_app con public=true y abrir el puerto. (Truco con HTTPS sin dominio propio:
  <ip-con-guiones>.sslip.io como dominio en Caddy.)
- Comprobar: deploy_status {server, domain, port}.
- Deshacer: «web.caddy-borrar-sitio» o «web.nginx-borrar-sitio» {dominio}.

## 6. Final
deploy_status con todo (user, port, domain) y cuéntale al usuario: la URL, dónde está (usuario, carpeta,
servicio), cómo actualizar (repetir upload + deploy_app) y cómo deshacer cada paso.

## Reglas
- Nada como root: la app corre con su usuario. No le des sudo ni lo añadas a wheel/sudo.
- No toques usuarios protegidos (protectedUsers en list_servers) ni sitios o servicios que no creaste.
- Un paso cada vez; si uno falla, para, lee el error y explícalo antes de seguir.
- No abras al exterior el puerto de la app si va detrás de Caddy/nginx.
"#;
