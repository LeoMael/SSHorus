# SSHorus — Pendientes e ideas

Este archivo es **la lista única** de lo que falta y de las ideas abiertas. Al decir «continúa», empezar por el
resumen de abajo. Todo el detalle de las rondas anteriores (decisiones, diseño de cada función, pruebas y lo que
quedó sin verificar) está en el **[historial](historial/PENDIENTES-historial.md)**; ahí no se borra nada.

## Resumen al día

*Actualizado el 26/11/2026.*

Última versión etiquetada: **1.0.0-beta.6** (27/11/2026; tandas 5–7 revisadas; subir solo si el usuario lo aprueba;
la CI la empaqueta en un Release en **borrador**). La beta.5 está subida (borrador). La etiqueta `v1.0.0-beta.4`
quedó solo en local, a propósito. Lo que entre en `main` después saldrá en la **1.0.0-beta.7**.

**Para retomar (estado al 26/11/2026, noche):**
- **Hecho:** tandas **1 a 4** del plan (tabla de abajo), unidas en `main`, revisadas (`/code-review` del lote) y
  subidas como **beta.5**: reglas de calidad en la CI, CSS y Rust partidos, `commands.rs` en cada módulo, **0 ciclos,
  0 excepciones de límites y 0 archivos de más de 500 líneas**, `index.ts` en todas las features, limpiezas de
  Volúmenes y Redes con «Todos», avisos con botón, «Renombrar máquina…», **«Cerrar puerto»** (idea 12) y **pruebas
  por distro** (idea 13, `npm run test:distros`, las 7 distros en verde).
- **Tandas 5 y 6 hechas (27/11), en `main` sin subir** (tanda 6: 4d auditoría programada y 5a Claude Code en el VPS, falta probarlas a mano). Tanda 5: idea **11** (Administración → **Configuración**: SELinux/AppArmor,
  SSH, actualizaciones automáticas, fail2ban, sysctl, sudo, hidepid; 7 distros en verde) e idea **4c** («Auditar
  proyecto» y auditoría de los contenedores sin root de cada usuario). Falta probar las dos a mano. Arreglado además:
  el arreglo de fail2ban de la Auditoría pone en la cárcel `sshd` los puertos reales de SSH.
- **Pasos al volver, en orden:**
  1. ~~Ver que el Release de la beta.5 se construyó~~ **hecho (26/11):** CI en verde y borrador con AppImage, deb,
     msi, exe, dmg, `latest.json` y firmas. Falta que el usuario lo **publique** en GitHub (Releases).
  2. El usuario prueba la beta.5 en su VPS (Rocky): «Cerrar puerto…» (Puertos y mapa), «Limpiar sin usar» de
     Volúmenes/Redes/Imágenes con «Todos», «Renombrar máquina…» y lo de §2 que siga pendiente.
  3. ~~**Tanda 5**~~ **hecha (27/11)** (diseño que se siguió):
     - **Idea 11, panel «Configuración»** en Administración: secciones SELinux/AppArmor (modo, denegaciones `avc`
       explicadas, booleans y contextos con «Arreglar» solo si es seguro), SSH (`sshd -t` antes de recargar y sin
       cortar tu SSH), actualizaciones automáticas, fail2ban, `sysctl` de red, sudo, `hidepid` y enlace al cortafuegos
       del mapa. Reutilizar la Auditoría (`features/audit/`), `features/admin/sshdConf.ts`,
       `features/infra/firewall/`, `features/privileges/run.ts`, `features/jobs` y `PlanReview`. Lógica en
       `features/serverConfig/`, interfaz en `components/Admin/config/`; añadir el área a `npm run test:distros`.
     - **Idea 4c:** «Auditar proyecto» (todos los servidores de un proyecto, máx. 3 a la vez, resumen comparado, desde
       el menú del proyecto en la barra lateral) y auditar los contenedores rootless de cada usuario como su dueño
       (`--privileged`, puertos en 0.0.0.0, `latest`, root dentro, montajes peligrosos, sin límite de memoria).
  4. ~~Tanda 6~~ **hecha (27/11)**: 4d auditoría programada + 5a Claude Code en el VPS. ~~Tanda 7~~ **hecha (27/11)** (5b: `get_deploy_guide`, `create_app_user`,
     `deploy_app`, `check_dns`, `deploy_status`; falta probar a mano en un servidor con systemd). Revisada (`/code-review` del lote
     `10e7c66..eb4d25e`, 8 arreglos) y etiquetada **beta.6**. **Tanda 8 en marcha** (ver su fila en la tabla): unidos
     el mapa y comparar archivos; en marcha historial por servidor, sincronizar carpeta y más Administración; falta
     lanzar archivos virtuales (el último). Si la sesión se cortó, recuperar las ramas `worktree-agent-*` con commit → beta.6 y beta.7; al final pruebas a mano y **1.0.0** (quitar
     `bundle.windows.wix.version`).
- **Siempre:** preguntar al usuario antes de cada push o versión; `/code-review` del lote antes de cada versión;
  reglas de recursos de `dev/REGLAS-AGENTES.md` §2.
- **Suelto:** quedó la imagen `debian:stable-slim` en podman (de la revisión; se quita con
  `podman rmi debian:stable-slim`).

### Plan inmediato para cerrar todos los pendientes (25/11/2026)

Por tandas de ~45–60 min, como mucho **2 agentes compilando Rust a la vez** (la PC tiene 15 GB). Cada tanda termina con
todo unido en `main` y comprobado (lint, build, `npm test`, clippy, `cargo test`).

| Tanda | Qué | Agentes | Sale en |
|---|---|---|---|
| **1. Revisión y reglas** | `/code-review` del lote nuevo + arreglar lo que salga · reglas automáticas de calidad en la CI (límites entre carpetas, dependencias circulares, tope de 500 líneas con lista de excepciones que solo puede bajar) | 2 | **beta.4** (el usuario prueba en su VPS mientras sigue el plan) |
| **2. Deuda técnica (interfaz)** | Partir los 11 CSS de más de 500 líneas · CSS propio de `ui/AdmModal` · partir `components/Admin` por tema (usuarios, puertos y sitios, vulnerabilidades, auditoría, visibilidad) · unir `SbContextMenu` con `ui/ContextMenu` — **hecho (26/11)** | 1 (solo interfaz) | beta.5 |
| **2. Deuda técnica (motor)** | Partir los archivos Rust de 400–500 líneas · un criterio fijo para los comandos Tauri (`commands.rs` en cada módulo) — **hecho (26/11)** | 1 (Rust) | beta.5 |
| **3. Deuda técnica (resto)** | Archivos TS de 400–500 líneas · `index.ts` en todas las features · ciclos y límites entre carpetas (`scripts/deps-allowlist.json` y `EXCEPCIONES_LIMITES` de `eslint.config.js`) · limpiezas de Volúmenes y Redes con «Todos» · avisos con botón en `Toaster` (BASE) · renombrar el grupo de máquina en la barra lateral · la lista de excepciones de líneas queda en **cero** — **hecho (26/11)** | 2 | beta.5 |
| **4. Funciones A** | **13** pruebas por distro (primero: valida todo lo demás) · **12** «Cerrar puerto» que haga lo correcto — **hecho (26/11)** | 2 | beta.5 |
| **5. Funciones B** | **11** configuración y seguridad del servidor · **4c** auditar proyecto y contenedores de otros usuarios — **hecho (27/11)** | 2 | beta.6 |
| **6. Funciones C** | **4d** auditoría programada · **5a** Claude Code en el VPS con tu cuenta — **hecho (27/11)** | 2 | beta.6 |
| **7. Funciones D** | **5b** despliegue asistido por IA (MCP) — **hecho (27/11)** | 1 | beta.6 |
| **8. Ideas menores** | **Decidido por el usuario (27/11):** historial por servidor (**7.10**) y pulido del mapa (en marcha); además **7.7** comparar archivos, **7.5** sincronizar carpeta, **8.2+** más Administración (servicios systemd, paquetes, cron/timers) y **arrastre con archivos virtuales** (Windows/macOS), en ese orden, 2 agentes a la vez. **ProxyJump (7.2) no**: queda para después de la 1.0.0 | 2 por ronda | beta.7 |
| **Al final** | Pruebas a mano del usuario (§2) → **1.0.0** (quitar `bundle.windows.wix.version`) | — | **1.0.0** |

Fuera de este plan: **6** app móvil (proyecto aparte), **firmar el instalador de Windows** (necesita un certificado de
pago) y las pruebas en entornos reales que solo puede hacer el usuario (Windows, 2FA, agente SSH).

### 1. Hecho en `main` (sin publicar todavía)
- **Administración → «Qué pueden ver»** + categoría `isolation` en **Auditar servidor** + casilla **«Permitir túneles SSH»** en «Nuevo usuario con clave» (apagada por defecto sin sudo).
- **Contenedores → «Al reiniciar»** siempre visible (y en Inspeccionar), linger inmediato, soporte de unidades como `podman-compose@*.service`, Podman de otros usuarios en `/tmp/sshorus-run-<uid>` y gestión de permisos en Usuarios → Contenedores.
- **Sitios web → «Tráfico»**: monitor bajo demanda para Caddy y nginx (`nice`/`ionice`, límite de 8 MB, también los rotados) con activación segura de log dedicado y rotación, ya como tarea en segundo plano paso a paso (dueño del log de Caddy, SELinux `httpd_log_t`, `server` correcto en nginx, visita de prueba, «Quitar registro…»). Código: `features/admin/webTrafficSetup.ts`, `webLogPatch.ts`, `webLogResult.ts`, `webLogJob.ts` y `components/Admin/web/WebLogDialog.tsx`.
- **«Reiniciar ahora»** (escáner, auditoría, Panel de VPS), **MCP `reboot_server`**, **terminal tras reinicio** (distingue tmux reenganchado vs nuevo), **IA de informes** con reintento sin `temperature`, escritura sin retraso (`TCP_NODELAY`), botón de llave sudo en terminal y ventana de «Aceptar automáticamente».
- **Mapa de infraestructura**: zoom con rueda del ratón, pellizco táctil y `Ctrl +` / `−` / `0`.
- **Orden del código (Partes 1, 2 y 3)**: ESLint con 0 errores y 0 warnings, `cargo clippy` con 0 warnings, todos los archivos > 500 líneas divididos en módulos cohesivos (TS/TSX y Rust) y `src/features/` organizado 100 % en subcarpetas por dominio (sin archivos sueltos en raíz).
- **Arreglos tras la revisión**: «Comprobar configuración» (Sitios web) ya no se repite sola al escribir la contraseña
  de sudo, la lista de transferencias de un lote grande no se refiltra cada segundo, «mostrar servidor» en la barra
  lateral espera a que la fila aparezca, la terminal separa ajuste de tamaño, búsqueda y avisos (`termFit`,
  `termSearch`, `termMessages`), vuelven comentarios explicativos perdidos, nuevo **`npm test`** y la CI ejecuta
  ESLint y las pruebas.
- **Orden del código (parte 4)**: funciones compartidas sin copias (`src/lib/remote/`, `features/privileges/run.ts`,
  una sola lectura de llaves `.pub` en `localkeys/pubkeys.rs`) y un criterio de carpetas
  ([`ARQUITECTURA.md` §5, «Dónde va cada archivo»](ARQUITECTURA.md#dónde-va-cada-archivo-criterio-de-carpetas)).
  Cambio visible: «Nuevo usuario con clave» solo lista llaves `.pub` válidas.
- **MCP: la IA nunca ve contraseñas**: nueva herramienta `run_with_password` (diálogo propio; SSHorus escribe la
  contraseña en un PTY y la tapa en la salida), `request_sudo_password` apagado por defecto (ajuste nuevo
  `allowSudoReveal`), salidas de `run_command`/`read_file` con las contraseñas guardadas tapadas y `upload` sin llaves
  privadas ni la carpeta de SSHorus.
- **Contenedores → Compose** (después de la beta.3): «Ver y arreglar» cuando un nombre de contenedor ya está en uso
  (reemplaza el viejo sin tocar volúmenes y avisa si hay datos en riesgo), tareas largas en segundo plano (botón
  «Tareas», salida en vivo, aviso «sin salida nueva», Cancelar que para en el servidor) y «Editar compose» de otro
  usuario con sudo (copia `.bak-sshorus-<fecha>` y «Aplicar cambios»).
- **Barra lateral: cuentas del mismo servidor agrupadas** (mismo host y puerto) bajo un nodo plegable, con la de sudo
  primero y marca «S». El sudo sale de la conexión abierta, de lo último detectado (guardado por servidor) o de la
  contraseña de sudo configurada. ~~Nombre propio para el nodo~~ **hecho (26/11):** «Renombrar máquina…» (se guarda en
  `localStorage`, como los plegados). Pendiente: unir alias de `~/.ssh/config` que apuntan al mismo `HostName` (el
  perfil no guarda esa información).
- **Tareas en segundo plano para toda la app** (después de la beta.3): ventanita abajo a la derecha («2 tareas»),
  vista grande con salida en vivo, pasos, tiempos, Cancelar y «Copiar salida», historial de la sesión y aviso con
  «Ver». Van como tarea: Compose y Descargar imagen, Vulnerabilidades → Arreglar, Actualizar imagen, Auditoría →
  Arreglar / Arreglar todo lo seguro y Reiniciar ahora (sustituye al aviso flotante de abajo a la izquierda). Código:
  `features/jobs/` (lógica y ejecución), `stores/jobs.ts`, `components/Jobs/`.
- **Bases de datos (idea 9, solo lectura)**: pestaña nueva con el esquema de PostgreSQL, MySQL/MariaDB y SQLite (del
  servidor o de contenedores, también de otros usuarios con sudo), búsqueda, diagrama, «Copiar DDL» y credenciales
  guardables en la bóveda; MCP `get_db_schema`. Código: `features/databases/`, `components/Databases/`,
  `storage/db_secret.rs`, `mcp/core/db_schema.rs`. Falta probar a mano (§2).

- **Mapa → Cortafuegos**: clic en el cortafuegos y se ven sus reglas en palabras simples (firewalld, ufw, nftables,
  iptables; las de Docker/Podman aparte), avisos cruzados con los puertos y cambios seguros en firewalld y ufw
  (abrir, quitar, activar; comandos a la vista, a prueba con vuelta atrás en el servidor y prueba de conexión
  nueva). Mapa: panel de detalles y leyenda nuevos, nodos con teclado. Código: `features/infra/firewall/`,
  `components/InfraMap/Firewall*.tsx`.

Detalle de estas rondas: [historial, «Ronda de pruebas del 18–23/11» y «Ronda de orden del código»](historial/PENDIENTES-historial.md#próxima-sesión-anotado-el-13112026).

### 2. Pendiente inmediato (antes de publicar `1.0.0-beta.3`)
- **Probar a mano en la app real (`npm run tauri dev`) contra VPS reales**:
  - «Qué pueden ver» + arreglos automáticos + categoría `isolation` en Auditoría + crear usuario sin túneles.
  - Contenedores («Al reiniciar», linger, `podman-compose@*.service`) y Sitios web → «Tráfico» (Caddy y nginx con/sin log).
  - **Sitios web → «Activar registro de visitas» en el VPS Rocky con SELinux en `Enforcing`** (probado solo en
    contenedores, donde SELinux no actúa): con Caddy y con nginx, activar en un sitio sin log, en uno con log común y
    en uno de Caddy con `log` al diario; seguir los 7 pasos en la tarea, que la visita de prueba aparezca y que
    «Tráfico» lea el archivo nuevo. Mirar `ls -Z /var/log/caddy /var/log/nginx` (debe salir `httpd_log_t` si el
    servicio corre como `httpd_t`: `ps -eZ | grep -E 'caddy|nginx'`) y `sudo ausearch -m avc -ts recent`. Activar dos
    veces (no duplica), cancelar a mitad (el archivo queda como estaba), «Quitar registro…», y un sitio con un error
    a propósito en otra parte de la configuración (debe parar en «Revisar»). Preguntar al usuario qué le falló la
    primera vez (versión de Caddy: `caddy version`; ¿EPEL o el repo oficial?) por si era otra cosa.
  - MCP `reboot_server` y `request_sudo_password` con Claude Code / Claude Desktop reales.
  - MCP `run_with_password` con programas reales: `passwd`, `su` y `mysql -p` (contraseña guardada, otra escrita y
    «No permitir»; contraseña incorrecta: debe pararse sin repetir) y que la salida llegue tapada.
  - Ajustes → Asistentes de IA: el texto nuevo de «Permitir que la IA pida ver la contraseña de sudo» y que viene
    apagado (también si antes estaba encendido).
  - «Nuevo usuario con clave»: la lista de llaves de `~/.ssh` solo muestra `.pub` válidas.
  - Barra lateral: «mostrar servidor» (también al mover un servidor a un proyecto) y Sitios web → «Comprobar
    configuración» (que no se repita al escribir la contraseña de sudo).
  - Barra lateral con cuentas agrupadas (TESIS, Leo y Leo_oti en `2.25.131.217`, Portal aparte): nodo con «3 cuentas»
    y punto verde al conectar una; «S» en la de sudo tras conectarse (y que siga al reiniciar SSHorus); plegar y
    desplegar (clic, `→`/`←`, se recuerda al reiniciar); buscar «leo» (nodo desplegado); «mostrar servidor» de una
    cuenta con el nodo plegado (debe desplegarlo); dentro de un proyecto con dos de esas cuentas; menú contextual del
    nodo y de cada cuenta; doble clic para abrir; tema claro y oscuro.
  - Compose de otro usuario siendo admin (proyecto `seguimiento_siu` en el VPS): «Ver y arreglar» con el contenedor
    `seguimiento-siu-db` repetido, «Actualizar» en segundo plano y Cancelar a mitad (con sudo/`runuser`), «Editar
    compose» y «Aplicar cambios». **Ojo con postgres 18:** guarda los datos en `/var/lib/postgresql/18/docker`; un
    volumen en `/var/lib/postgresql/data` no los protege. Revisar el compose antes de reemplazar la base de datos.
  - **Arranque solo de `seguimiento_siu` (admin, «Usuario: leo_oti» y «Todos»)**: «Hacer que arranque solo…» en
    `seguimiento-siu-db` debe proponer el servicio (o prepararlo: plantilla + `register`) en vez del callejón sin
    salida; mirar los comandos en la revisión, lanzarlo y comprobar que al final dice «arrancará solo» y que
    `systemctl --user status podman-compose@seguimiento_siu` (como `leo_oti`) está activo. Comprobar que
    `podman-compose systemd -a create-unit` de la versión del VPS imprime la plantilla (sin root no puede escribir
    en `/etc/systemd/user`) y que el servicio arranca el pod `pod_seguimiento_siu` (si los contenedores no están en
    un pod debe recomendar la política de reinicio). Probar también la otra forma (casilla «Usar en su lugar la
    política de reinicio») y **Editar compose…** desde esa revisión. Reiniciar el VPS y ver que la base arranca sola.
    Con linger apagado, que lo active antes (sudo) y espere a su systemd de usuario. «Sin datos» con su motivo al
    pasar el ratón.
  - **Imágenes de `leo_oti` como admin (con «Todos» y con su usuario)**: «Limpiar sin usar» ya no gris (o con su
    motivo debajo), vista previa (sin nombre / todas) con tamaño, tarea en segundo plano; elegir varias (casillas,
    `Espacio`, `Ctrl+A`), **Eliminar…** con una en uso (se queda; con **Forzar**, aviso) y **Detalles** (contenedores
    que la usan).
  - Monitor → Por usuario en el VPS Rocky (Podman sin root por usuario): que `590822` y los demás números salgan
    como «Contenedor … · de leo_oti · uid … dentro» bajo su dueño, con el nombre real del contenedor; la nota al
    elegir la fila y **Ver en Contenedores** (como `leo_oti`, como admin con sudo y sin sudo); el aviso de
    «Terminar» en un proceso de contenedor; «tú» separado del nombre; con hidepid y sin sudo, «Sin identificar ·
    haría falta sudo». Mirar que el muestreo no pese más (1 vCPU).
  - **Emparejar asistentes (idea 10)**: con la app real, pedir a Claude Code «conéctate a SSHorus ejecutando
    `sshorus-mcp pair`» (diálogo encima de Ajustes, datos de programa/PID/carpeta, Aceptar con permisos; que se
    registre solo con `claude mcp add -s user` y funcione tras `/mcp`); lo mismo con Codex (su sandbox sin red: que
    el aviso se entienda y funcione fuera del sandbox); dos IA a la vez con permisos distintos (cada una ve solo lo
    suyo en `list_servers`); «Cambiar permisos» y «Revocar» (la revocada recibe «ya no está emparejado» al instante y
    queda en Actividad); con SSHorus bloqueado (rechazo sin diálogo) y bloqueándolo con el diálogo abierto; límite
    (dos `pair` seguidos del mismo asistente → el segundo «espera»; más de 3 por minuto → 429 sin diálogos); que
    `~/.local/bin/sshorus-mcp` se cree al abrir la AppImage y se actualice con una versión nueva; en Windows y macOS
    (detección del programa y ruta `%LOCALAPPDATA%\SSHorus\bin`); el puente sin emparejar enseña
    `sshorus_emparejar` y, tras emparejar, la llamada a esa herramienta trae las herramientas sin reiniciar.
  - **Escáner: «Arreglar» dice la verdad (VPS Rocky)**: antes de nada, «Volver a comprobar» y ver que openssl,
    vim, grub2 y demás paquetes con epoch ya no salen si están al día (era el fallo del epoch). Después, «Arreglar»
    con un paquete que tenga actualización pendiente de verdad (`sudo dnf check-update`) y leer el resultado por
    paquete (Arreglado / falta reiniciar / Sin versión corregida en tus repos / Falló con la línea de dnf). Probar
    uno que esté en el grupo «Aún no en tus repos» (no debe ofrecer «Arreglar»; su detalle, «Por qué sigue
    apareciendo»). Actualizar el kernel, reiniciar desde fuera de SSHorus, volver a abrir la pestaña: debe salir
    «El servidor se reinició después de este análisis»; «Volver a comprobar» y que el kernel ya no esté. Mirar
    `uname -r`, `rpm -q kernel-core` y `sudo grubby --default-kernel`. Si algo sigue, anotar el CVE, el paquete y la
    salida de `sudo dnf --refresh check-update <paquete>`.
  - **Emparejar por OAuth (idea 10b)**: `claude mcp add --transport http sshorus http://127.0.0.1:47821/mcp` (sin
    token) y `/mcp` → Authenticate: que se abra el navegador con «Vuelve a SSHorus para aceptar», salga el mismo
    diálogo con identidad «comprobada … claude.ai», navegador y «Vuelve a», y al aceptar el navegador vuelva solo a
    Claude Code y funcionen las herramientas con SUS permisos; rechazar (Claude Code dice que se denegó); dejar pasar
    los 2 min; bloquear SSHorus con el diálogo abierto. Que siga funcionando tras 1 h (renueva solo) y tras reiniciar
    SSHorus. En la lista sale «HTTP (OAuth)»; «Cambiar permisos» se nota al momento; «Revocar» corta al instante y
    Claude Code vuelve a pedir autorización. Codex: `codex mcp add sshorus --url http://127.0.0.1:47821/mcp` y
    `codex mcp login sshorus` (registro dinámico: identidad «sin comprobar»). Sin red (sin poder descargar la ficha
    de claude.ai): que el error se entienda. Con `localhost` en vez de `127.0.0.1`. Que «Aceptar automáticamente» se
    ofrezca en un servidor donde solo un asistente tiene Completo y no valga para otro con Solo lectura.
    **«Cambiar permisos»** de un asistente sin acceso a nada: dar acceso a un servidor no da «Solo lectura» al resto.
  - Escáner («Arreglar todo», «Actualizar imagen»), Auditoría («Arreglar todo lo seguro»), terminal tras reinicio, IA sin `temperature` y flujos tocados por el refactor (barra lateral, explorador, pestañas, ajustes, transferencias).
  - Tareas en segundo plano (VPS Rocky de 1 vCPU): Vulnerabilidades → «Arreglar todo lo que tiene solución», cerrar
    el diálogo y seguirla en la ventanita de la esquina (salida de `dnf` en vivo, barra «3/10», aviso «Sin salida
    nueva» si se calla); «Cancelar» a mitad y comprobar en el servidor que no queda `dnf` (`pgrep -a dnf`); dejarla
    pasar de 600 s y ver que también se detiene. Lo mismo con Auditoría → «Arreglar todo lo seguro» y con «Actualizar
    imagen» (con y sin contenedores creados a mano). «Reiniciar ahora»: la ventanita se abre sola con los tres pasos,
    «Dejar de esperar» y, si la conexión se cierra, «Reconectar». Compose: botón «Tareas» abre la lista filtrada y
    «Ver y arreglar» desde la vista grande lleva a Contenedores. Comprobar que la ventanita no tapa la barra de
    transferencias (plegada y abierta) ni los avisos, en tema claro y oscuro, y que se maneja con el teclado
    (Tab, Enter, Escape).
  - **Bases de datos (idea 9)** en el VPS Rocky: que aparezcan los PostgreSQL de los contenedores de cada usuario
    (`seguimiento-siu-db`, `sigpa-db`, `oti-db`…) como admin con sudo, y solo los tuyos sin sudo; entrar sin
    contraseña (dentro del contenedor, también uno de otro usuario con `runuser`), elegir la base, buscar, abrir una
    clave foránea, **Diagrama** (tema claro y oscuro, caja elegida y sus flechas), **Copiar DDL** (`pg_dump` de la
    imagen) y **Cancelar** a mitad. Un PostgreSQL o MariaDB del sistema (con sudo: como `postgres`/root; sin sudo:
    pedir usuario y contraseña, «Guardar», que la próxima vez entre solo y que la papelera la olvide). Un archivo
    SQLite (**SQLite…**) y uno sin permiso de lectura. Comprobar en el servidor que la contraseña no sale en
    `ps aux` mientras corre y que el muestreo no pesa (1 vCPU). MCP: `get_db_schema` sin `target` (lista), con
    `target` (bases) y con `database`/`table`, y que sin credencial guardada pida guardarla en SSHorus.
  - **Mapa → Cortafuegos** (clic en el escudo del mapa): en el **VPS Rocky con firewalld**, que salgan las zonas
    en uso, los servicios con su puerto (ssh → TCP 22), las reglas enriquecidas y las de Podman aparte; los avisos
    «escucha pero bloqueado» / «abierto sin nada escuchando» comparados con Administración → Puertos. «Abrir puerto
    o servicio» (443/tcp y uno solo para tu IP), ver la tarea, la prueba de conexión nueva y «Hacer permanente»
    (`sudo firewall-cmd --permanent --list-all` debe tenerlo); otro sin confirmar y comprobar que a los 5 min el
    servidor lo quita solo (también cerrando SSHorus); «Deshacer ahora». **Antilockout**: la papelera del servicio
    `ssh` debe estar desactivada con su explicación (y activa si hay otra regla para el 22). En un **Ubuntu con
    ufw**: reglas `(v6)` juntas, `limit`, perfiles («Nginx Full»), quitar una regla (a prueba, «Mantener»; y otra
    con «Deshacer ahora»: debe volver a su mismo número en `sudo ufw status numbered`, con su comentario), y con
    ufw apagado «Activar ufw» (antes añade `ufw allow 22/tcp`; casilla obligatoria). En un **Debian con nftables**
    (y Docker): frases de cada regla, la cadena a la que se salta, las de Docker en «Creadas por Docker/Podman» y el
    aviso de solo lectura. Sin sudo: el aviso y «Escribir la contraseña de sudo». Teclado (Tab entre nodos, Intro,
    Esc), leyenda plegable y tema claro y oscuro.
  - Las listas paso a paso de cada ronda siguen en el historial («Falta probar en la app» del 16/11 y «Probar a mano en la app» de la Parte 1 del orden del código).
- **Publicación de la `v1.0.0-beta.3`**: versión subida, `bundle.windows.wix.version` en `0.6.0.3` (el `.msi` no
  admite «-beta»; se quita al pasar a `1.0.0`), CHANGELOG cerrado y etiqueta creada. Falta: comprobar el borrador
  del Release, publicarlo y verificar que la CI publique
    `latest.json` + firmas `.sig` (en las betas Linux solo genera `.deb` y AppImage, sin `.rpm`) y que el actualizador
    de la beta.2 detecte la beta.3.

### 3. Pendiente técnico y de distribución (sin fecha fija)
- **Firmar el instalador de Windows** (para evitar el aviso de SmartScreen).
- **Pruebas en entornos reales pendientes**: Windows real (y agente SSH de Windows: OpenSSH pipe / Pageant), servidor con **2FA** real, **agente SSH** real, **arrastre de archivos al escritorio** en Linux/Windows/macOS (macOS sin compilar localmente) y **medir rendimiento** en la app real con el panel de diagnóstico.
- **Pruebas automáticas de interfaz (E2E)** con la app real abierta.
- **Escáner de vulnerabilidades** ([10.14](historial/PENDIENTES-historial.md#1014-sin-verificar-y-riesgos)): Docker real, SLES/RHEL, otros usuarios con systemd.
- ~~Revisar los 3 tests de integración de túneles que fallaban~~ **Resuelto (24/11)**: la causa era la configuración
  del servidor de pruebas `terview-sshd`, no el código. Con `AllowTcpForwarding yes` (y `PerSourcePenalties no`) en
  `/config/sshd/sshd_config` pasan, y la batería completa (`--include-ignored`) dio 426/426. Cómo prepararlo: README,
  [«Pruebas»](../README.md#pruebas).
- **Lo que quedó «sin verificar» en cada función** (listas en el historial): [MCP](historial/PENDIENTES-historial.md#sin-verificar),
  [tmux](historial/PENDIENTES-historial.md#76-terminales-persistentes-con-tmux---hecho-v040),
  [PIN y bóveda](historial/PENDIENTES-historial.md#77-pin-bóveda-cifrada-y-bloqueo---hecho-v040),
  [otros pendientes detectados](historial/PENDIENTES-historial.md#4-otros-pendientes-detectados) (2FA, agente, arrastre, cancelar).

- ~~**Contenedores con «Todos»:** las limpiezas de **Volúmenes** y **Redes** desactivadas con «Todos»~~ **hecho (26/11):**
  limpian como cada dueño (`features/containers/prune.ts`, el mismo código que Imágenes) y dicen por qué cuando no se puede.
- ~~**Avisos con botón en `Toaster`**~~ **hecho (26/11):** `toast.*(…, { action: { label, onClick } })`; el «Ver» de
  las tareas en segundo plano usa el mismo aviso (`ToastCard`).
- **CSS de `ui/AdmModal`:** varias pantallas copian reglas de `.adm-modal` (Contenedores, MCP, Bases de datos); moverlas
  a un CSS propio de `components/ui/AdmModal`.

- **Pendiente de la revisión del 26/11 (no bloquea):** cortafuegos: la vuelta atrás programada puede morir con
  `KillUserProcesses=yes` (usar `systemd-run`), la protección anti-bloqueo da por buena la zona si no la sabe y mira
  las reglas vivas, no las `--permanent`; sitios web: dos tareas sobre el mismo archivo pueden pisarse (`flock`);
  `podman-compose systemd register` podría recrear contenedores (confirmar); escáner: `grubby` sin root, epochs
  mezclados, «reiniciar servicios» marcado en todos los paquetes; bases de datos: con contraseña no entra por socket
  local, charset de mysql sin fijar, bóveda bloqueada parece «sin credencial»; lista `ARCHES` repetida 3 veces;
  OAuth: la descarga del documento del cliente no bloquea IP privadas (riesgo bajo, petición GET a ciegas).
- **Pendiente de la revisión del 26/11 (beta.5) (no bloquea):** cambios pequeños de comportamiento que dejaron los
  refactors, a decidir si se quedan: en el menú de la barra lateral, Escape dentro de un submenú vuelve al menú de
  arriba en vez de cerrarlo todo (`ui/ContextMenu`); «Ver» del aviso de una tarea ahora también cierra el aviso
  (`ToastCard`); en los menús «plain» (Administración, Contenedores) el texto ya no salta de línea
  (`.cm-label` con `nowrap`). Auditoría en openSUSE: si `zypper list-patches` falla se cuentan 0 parches de
  seguridad en vez de «no se sabe», y `zypper patch` sale con código 103 cuando se actualiza a sí mismo (se ve
  como fallo; hay que repetirlo). Escáner: `vulnscan_rescan_image` y `vulnscan_recheck` registran el ticket de
  cancelación antes de mirar si existe el informe (inofensivo).
- **Pendiente de la revisión del 27/11 (beta.6) (no bloquea):** auditoría programada: `busy` solo mira las filas de
  «Auditar proyecto», no una auditoría manual de Administración → Auditoría (`useAuditRun.running`), y
  `startProjectAudit` no mira si la tanda programada ya tiene esos servidores: el mismo servidor se puede auditar dos
  veces a la vez y una tarea pisa la fila de la otra; si se bloquea a mitad, el servidor que ya se estaba auditando
  sigue (sin la contraseña de sudo guardada puede salir «empeoró» de más); cancelar la tanda a mano la da por hecha
  hasta la siguiente. Desplegar con la IA: `uploaded_path` comprueba la ruta y el script la usa después (un enlace
  cambiado entre medias en `/tmp`; ahora se lee como el usuario conectado, riesgo bajo); un `exec_start` o una
  variable que acabe en «\» une la línea siguiente de la unidad o del archivo de systemd; `container_port` sin
  `port` se ignora sin avisar. Claude Code en el VPS: si el script falla tras recibir la llave queda
  `~/.config/sshorus/claude-token.<pid>` (0600) y «Quitar» no lo borra; «Quitar» deja vacíos `.profile`/`.zshrc` si
  los creó SSHorus. Configuración: fail2ban no ofrece desbloquear IPv4 escritas como IPv6 (`::ffff:…`).

#### Reglas automáticas de calidad (aprobadas el 24/11/2026; 1–3 hechas el 25/11, salen en la beta.4)
Para que el orden no dependa de que cada agente se acuerde, la CI falla si se rompe el criterio de
[`ARQUITECTURA.md` §5](ARQUITECTURA.md#dónde-va-cada-archivo-criterio-de-carpetas). En local: `npm run check`.
1. ~~Límites entre carpetas con ESLint~~ **Hecho**: `no-restricted-imports` y `no-restricted-syntax` de ESLint (sin
   plugins) en `eslint.config.js`; cuenta también `import()` diferido.
2. ~~Dependencias circulares entre carpetas~~ **Hecho**: `npm run check:deps` (`scripts/check-deps.mjs`, lee los
   imports con el compilador de TypeScript, sin dependencias nuevas).
3. ~~Tope de 500 líneas por archivo~~ **Hecho**: `npm run check:lines` (`scripts/check-lines.mjs`; `.ts`, `.tsx`,
   `.rs` y `.css`).
4. **Revisión de código antes de cada versión** (`/code-review` del lote) y anotar en el CHANGELOG lo que se arregló.
   Es un paso del proceso (no lo mira la CI); anotado en `dev/REGLAS-AGENTES.md` §5.
Lo que ya incumplía 1–3 está en las listas de excepciones (ver «Deuda técnica»), que solo pueden encoger.

#### Deuda técnica (no bloquea la 1.0.0)
Reglas de calidad en [`dev/REGLAS-AGENTES.md`](dev/REGLAS-AGENTES.md) §5 y criterio de carpetas en
[`ARQUITECTURA.md` §5](ARQUITECTURA.md#dónde-va-cada-archivo-criterio-de-carpetas).
**La lista al día de lo que incumple las reglas automáticas son los archivos de excepciones** (cada entrada con su
`TODO(deuda)`; solo pueden encoger, y al arreglar algo se borra su línea):
- `scripts/lines-allowlist.json`: archivos de más de 500 líneas (26/11/2026: **vacía**; los 11 CSS que había se partieron por tema).
- `scripts/deps-allowlist.json`: ciclos entre carpetas (26/11/2026: **vacía**; los 16 ciclos se rompieron moviendo
  cada pieza a su carpeta).
- `EXCEPCIONES_LIMITES` en `eslint.config.js`: imports que cruzan límites (26/11/2026: **vacía**; la terminal local,
  `settingsNav`, el diálogo de sudo, `openLink`/`ServerSelect` y el lector de Markdown ya están en su sitio).

Lo de abajo se midió el 24/11/2026 con `wc -l`, sin contar pruebas.
- **Código entre 400 y 500 líneas (25):**
  - Interfaz: ~~`Admin/vulns/ImageUpdateDialog.tsx`, `Admin/users/KeyUserWizard.tsx`, `Containers/ContainersTab.tsx`,
    `Tabs/TabBar.tsx`, `Commands/CommandsPanel.tsx`, `Admin/vulns/VulnsTab.tsx`, `stores/transfers.ts`,
    `features/multirun/engine.ts`, `Containers/ImagesTab.tsx`, `Monitor/MonitorPanel.tsx`, `features/monitor/engine.ts`,
    `features/monitor/sample.ts`, `Admin/AdminPanel.tsx`~~ **partidos (26/11)**. También ~~`Terminal/termController.ts`, `About/markdown.tsx`,
    `features/vulnscan/run.ts`, `Terminal/TerminalView.tsx`~~ **partidos (26/11)**, todos por debajo de 300 (lo puro
    del Markdown en `lib/markdown.ts`).
  - Motor: **hecho (26/11)**, ningún archivo Rust de producción pasa de 400 líneas (el mayor es
    `vulnscan/analyze.rs`, 398).
  - ~~Justo en el límite (400): `Terminal/TerminalArea.tsx`~~ **partido (26/11)**: sub-pestañas, su tira y su menú aparte.
- ~~**`generatePassword` sigue en `features/admin/shell.ts`**~~ **hecho (26/11):** está en `lib/password.ts`.
- ~~**Ciclos entre carpetas**~~ **hecho (26/11):** `scripts/deps-allowlist.json` está vacía. El estado de la app ya no
  depende de ninguna función (cerrar y reconectar pestañas pasó a `features/connect/tabLifecycle.ts`; privilegios se
  entera de los servidores guardados con `onServerSaved`; lo puro de tareas y atajos vive en `stores/`), la cola de
  diálogos de sudo está en `features/privileges/sudoAsk.ts` y el diálogo en `components/Sudo/`.
- ~~**La familia de la distribución se detecta en 3 sitios**~~ **hecho (26/11):** una sola tabla en
  `lib/remote/distro.ts` (`distroFamily`), que usan Contenedores, tmux, la biblioteca de comandos y Administración.
- ~~**Los comandos Tauri no siguen un criterio fijo**~~ **hecho (26/11):** cada módulo con comandos tiene su
  `commands.rs` (o `commands/` por temas en `storage/`) con solo envoltorios finos, y `lib.rs` los registra como
  `modulo::commands::nombre` (regla en `docs/dev/REGLAS-AGENTES.md` §5).
- **Pantallas React dentro de `features/`** (26/11/2026: 51 `.tsx` y varios CSS, p. ej. `features/mcp`,
  `features/connect/ConnectDialogs.css`, `features/serverEditor`, `features/localterm/LocalMenu.tsx`): según
  ARQUITECTURA §5 van en `components/<X>/`. No lo mira la CI; moverlas poco a poco (y entonces añadir la regla a ESLint).
- **Lo que la batería por distro (idea 13) no puede probar en un contenedor:** sesiones abiertas (`who` sale vacío:
  no hay utmp), systemd (servicios, `systemctl is-active` de nginx/Caddy, journald), cortafuegos encendidos
  (firewalld/ufw necesitan systemd y permisos de red) y el PATH real de cada sshd (se simula el más corto, el de
  Debian). **openSUSE trae `Defaults targetpw`**: sudo pide la contraseña de **root**, no la del usuario, y SSHorus
  diría «La contraseña de sudo no es correcta»; la batería lo evita como haría un administrador (grupo `wheel` sin
  `targetpw`). Falta detectarlo y explicarlo en el diálogo de sudo. Probar todo esto en un servidor real.
- **Pruebas Rust aún grandes** (no cuentan para el tope, pero cuestan de leer): `mcp/tests.rs` (~720, casi todo el
  motor simulado), `ssh/connect_tests.rs` (564), `snippets/tests.rs` (518), `mcp/e2e_tests.rs` (493),
  `ssh/reconnect_tests.rs` (490), `mcp/tests_marked.rs` (476).
- ~~**Solo 12 de las 27 carpetas de `src/features/` tienen `index.ts`**~~ **hecho (26/11):** todas lo tienen, con la
  regla en `ARQUITECTURA.md` §5.

### 4. Ideas y funciones futuras anotadas

| # | Idea / función | Estado | Resumen y siguiente paso |
|---|----------------|--------|--------------------------|
| **5a** | **Claude Code en la terminal del VPS con cuenta del PC** | **Hecha (27/11), falta probar a mano** con una cuenta real en el VPS: que Claude Code arranque solo con la llave (`CLAUDE_CODE_OAUTH_TOKEN`, sin pantalla de inicio de sesión; SSHorus crea `~/.claude.json` con `hasCompletedOnboarding` si no existía) y con la sesión copiada, y «Quitar». Límites: solo el usuario con el que se entró (no otro usuario ni root); con la llave, las shells ya abiertas no la tienen hasta cargarla («Abrir Claude Code en la terminal» lo hace) y tras «Quitar» la siguen teniendo hasta cerrarlas; fish solo si existe `~/.config/fish`; otras shells (tcsh…) no; en macOS la sesión está en el Llavero (solo «Llave de acceso»); la llave no sirve para `claude remote-control`; en el servidor el archivo existe (Claude Code lo necesita): una IA con el MCP y permiso para ejecutar comandos como ese usuario podría leerlo (desde el 27/11 el MCP tapa con `••••` todo lo que empiece por `sk-ant-` en lo que devuelve a la IA: salidas de comandos y archivos) | Botón del robot en la barra de la terminal SSH (`components/Terminal/ClaudeVps*.tsx`): estado (usuario, Claude Code instalado o el instalador oficial), las dos formas con su línea, aviso de root, «Quitar mi cuenta de este servidor» y abrir `claude` en esa terminal. Lógica en `features/claudeVps/` (ver y quitar, comandos de la terminal, textos) y, lo que recibe el secreto, en el motor (`localterm/claude_vps/`, comandos `claude_vps_copy_session` y `claude_vps_set_token`). |
| **5b** | **Despliegue asistido por IA vía MCP** | **Hecha (27/11), falta probar a mano** con Claude Code en un VPS real (Rocky y Debian/Ubuntu): desplegar una imagen publicada, una imagen hecha en el PC (`image_archive`), un `build` en el servidor y un programa (`exec_start`), con dominio (Caddy) y solo con IP; actualizar y `remove`. Límites: `deploy_app` necesita systemd (no Alpine/OpenRC); en Debian/Ubuntu hacen falta `dbus-user-session` y `uidmap` (la receta lo dice, no se instalan solos); un solo puerto por app; `deploy_status` no ve el estado de la unidad del usuario ni sus contenedores sin sudo (mira puerto, HTTP, linger, su systemd y sus procesos); `check_dns` pregunta desde el servidor (`dig @1.1.1.1` o `getent`) y no ve una IP pública que no esté en sus interfaces ni en la dirección guardada; nginx sin HTTPS automático (certbot a mano por `run_command`); el cortafuegos y SELinux van con el catálogo o `run_command`; sin `server_status` propio (CPU/RAM/disco con los comandos 📊 del catálogo); las aprobaciones siguen en el PC (nada para el celular) | Receta `get_deploy_guide` (`mcp/deploy/guide.rs`: preguntas, comprobaciones, pasos con su herramienta, cómo comprobar y deshacer) y herramientas `create_app_user` (sin sudo, linger, subuid/subgid, `~/apps`), `deploy_app` (unidad systemd del usuario con Podman sin root o programa; copia lo subido con tar como el usuario; variables en un archivo 600; 127.0.0.1 salvo `public`; `remove`), `check_dns` y `deploy_status`. Los sitios reutilizan las filas de la Biblioteca (`web.caddy-crear-sitio`…). Permisos: los cambios usan sudo y preguntan siempre; «Solo lo marcado» pide «Usuarios: crear» o «Contenedores»/«Servicios»; se rechazan root, el usuario conectado y los protegidos; `copy_from`/`image_archive` solo desde la carpeta del usuario conectado o /tmp. Lógica pura en `mcp/deploy/` con pruebas (`sh -n` de cada script, archivos escritos de verdad, DNS y estado) y `tests_deploy.rs`; las lecturas probadas en el servidor de pruebas (busybox) y `create_app_user` en Alpine y Debian. |
| **4c** | **Auditoría extendida** | **Hecha (26/11), falta probar a mano** en un proyecto con varios VPS y en un servidor con contenedores Podman de otros usuarios. Límites: no pide contraseñas (SSH, 2FA ni sudo): lo que no conecta con lo guardado sale «No se pudo» y lo que no tiene sudo se audita sin él; «Cancelar» no para los servidores que usan una pestaña abierta (terminan su lectura); solo Podman sin root (no Docker rootless de otros usuarios); el límite de memoria es fijo (1 GB) y `podman update` no dura si el contenedor se vuelve a crear; el área no está en `npm run test:distros` (haría falta Podman dentro del contenedor) | «Auditar proyecto» (menú del proyecto y Panel del proyecto: 3 a la vez, tarea en segundo plano con un paso por servidor, nota de cada uno, media, lo que más se repite y «Abrir en Administración») y, con sudo, los contenedores sin root de cada usuario como su dueño (`--privileged`, montajes peligrosos, puertos en 0.0.0.0, `latest` o de más de 180 días, root dentro, sin límite de memoria, sin linger). Código: `features/audit/{projectAudit,projectAuditJob,projectStore,nav,userContainers,checksUserContainers}.ts`, `components/ProjectAudit/`. |
| **4d** | **Auditoría programada** | **Hecha (26/11), falta probar a mano** (dejar un servidor «cada día», cerrar SSHorus más de un día y abrirlo; empeorar algo a propósito y ver el aviso). Límites: solo con SSHorus abierto (sin servicio del sistema ni tarea en el servidor); la programación vive en este equipo (`localStorage`, clave `sshorus.audit.schedule.v1`), no viaja con la copia en Gist ni con `profiles.json`; sin notificación del sistema (no hay plugin de notificaciones; solo el aviso dentro de la app); mira cada 5 minutos, así que la hora exacta se corre unos minutos; con SSHorus bloqueado la salta y la hace al desbloquear; si no conecta con lo guardado (sin contraseña, 2FA, huella nueva) no se reintenta hasta el siguiente intervalo; un servidor que está a la vez en su programación y en la de su proyecto se audita una vez por tanda, pero cada programación lleva su cuenta | «Repetir auditoría: nunca / cada día / cada semana» en Administración → Auditoría y en «Auditar proyecto». Un planificador (`features/audit/scheduler.ts`) mira cada 5 minutos qué toca y al abrir pone al día lo atrasado una sola vez; la tanda es una tarea en segundo plano (`scheduleJob.ts`, 3 a la vez, reutiliza `auditServer` de «Auditar proyecto»: sin diálogos, sudo guardado, cierra su conexión). Compara con el informe anterior (`auditDiff.ts`, las mismas reglas que las flechas de la Auditoría; con y sin sudo no compara la nota) y, si empeoró, aviso con «Ver» (`components/ProjectAudit/AuditChangesDialog.tsx`); sin cambios, nada. Lo puro en `schedule.ts` (cuándo toca, puesta al día, bloqueo, notas), con pruebas `schedule.test.ts` y `auditDiff.test.ts`. |
| **6** | **App móvil propia (APK aparte)** | Decidida (16/11), en prueba de viabilidad | Proyecto separado en Tauri 2 Android con Linux mínimo (`proot` + Debian por defecto / Alpine opcional) para correr Claude Code, Codex, agy y OpenCode con MCP local de SSHorus Móvil (SSH directo celular → VPS, sin PC en medio). Prototipo en `docs/movil/prototipo.html`. Siguiente paso: probar `proot-distro install debian` + instalador oficial en Termux. |
| **7.2** | **Servidor intermedio (jump host / bastión)** | Después de la 1.0.0 (decidido el 27/11) | Llegar a servidores internos pasando por otro (`ProxyJump`). Muy común en empresas. |
| **7.5** | **Sincronizar carpeta** | Aprobada (27/11), tanda 8 | Carpeta local ↔ remota: al guardar en tu PC se sube sola (desarrollo web). |
| **7.7** | **Comparar archivos** | **Hecha (27/11), falta probar a mano** (local ↔ remoto, entre dos servidores, con una copia `.bak-sshorus-…` de «Editar compose», guardar la derecha y un archivo binario o de más de 5 MB). Límites: el otro servidor tiene que estar conectado en otra pestaña (no conecta solo); la comparación no se abre en ventana aparte; solo se edita y guarda la derecha (con «Intercambiar lados» se cambia cuál); de un archivo de tu PC no se sabe la fecha de modificación, así que al guardarlo no avisa si cambió mientras tanto; las copias que se ofrecen son solo las que ya hace SSHorus junto al archivo (`.bak-sshorus-<fecha>`, `.sshorus.bak`, `.bak`), no un historial de versiones | Explorador → clic derecho en un archivo → **Comparar con…** (un archivo de mi PC, el mismo en otra conexión abierta con la ruta editable, otro de este servidor o una copia de seguridad de la carpeta) o, con dos seleccionados, **Comparar los dos**. Se abre como una pestaña más de archivo con el editor de diferencias de Monaco: lado a lado o en línea, F7 / Mayús+F7, ignorar espacios, nombres «servidor:ruta» y guardar la derecha con la misma confirmación que el editor (`components/Editor/saveGuard.tsx`). Lo puro en `features/compare/` (lados, nombres, claves de pestaña, tamaño y binarios, copias) con `compare.test.ts`; la interfaz en `components/Compare/`. |
| **7.10** | **Historial por servidor** | Idea, sin empezar | Comandos usados en cada servidor y grabación opcional de sesiones (para auditoría). |
| **8.2+** | **Más Administración** | Aprobada (27/11), tanda 8 | Servicios (systemd: iniciar, parar, activar, logs), firewall, paquetes (actualizar, instalar) y tareas programadas (cron/timers). |
| **9** | **Ver bases de datos (esquema)** | **Hecha (25/11), falta probar a mano** (ver §2). Pestaña «Bases de datos» + MCP `get_db_schema` | PostgreSQL, MySQL/MariaDB (servidor y contenedores, también de otros usuarios con sudo) y SQLite por ruta: bases, tablas, columnas, índices, claves foráneas, búsqueda, diagrama y «Copiar DDL»; entra sin contraseña (contenedor, `postgres`/root con sudo, tu usuario) o con usuario y contraseña guardables en la bóveda. Solo lectura. Siguiente (si se pide): MongoDB/Redis y ver unas filas de ejemplo. |
| **10** | **Emparejar asistentes de IA con «Aceptar / Rechazar»** | **Hecha (25/11), falta probar a mano** (ver §2). `sshorus-mcp pair`, permisos propios por asistente, revocar, puente en `~/.local/bin` | Conectar Claude Code, Codex, etc. al MCP sin copiar el token: registro sin secretos (`claude mcp add -s user sshorus -- sshorus-mcp`), la primera conexión pide permiso en SSHorus (quién es, carpeta, acceso por servidor), si se acepta SSHorus da un token propio de ese cliente que el puente guarda en el llavero; lista de asistentes emparejados con «Revocar» en Ajustes; solo 127.0.0.1, límite de peticiones, nada con SSHorus bloqueado, todo en `mcp-audit.jsonl`. Contexto: copysse usará SSHorus (ver `~/LEO/Projects/CLAUDE_COPY/docs/HOJA_DE_RUTA.md` §2). |
| **10b** | **Emparejar por OAuth (estándar del MCP) para clientes HTTP** | **Hecha (25/11), falta probar a mano** (ver §2) | `claude mcp add --transport http sshorus http://127.0.0.1:<puerto>/mcp` sin token: 401 → metadatos (RFC 9728/8414) → documento de metadatos del cliente o registro dinámico → navegador «Vuelve a SSHorus para aceptar» → el mismo diálogo de la fase 1 → código (PKCE S256, 60 s, un uso) → token de acceso de 1 h ligado al recurso y de renovación que rota. Misma lista de asistentes («HTTP (OAuth)»), «Cambiar permisos» y «Revocar». Código en `mcp/oauth/` (ver ARQUITECTURA). Sin probar aún con Claude Code y Codex reales. |
| **11** | **Configuración y seguridad del servidor (un panel)** | **Hecha (26/11), falta probar a mano** en el VPS Rocky (SELinux enforcing con nginx/Caddy y Podman sin root) y en un Debian/Ubuntu con AppArmor. Sub-pestaña **Administración → Configuración** (`features/serverConfig/`, `components/Admin/config/`); reutiliza las secciones de `AUDIT_SCRIPT`, sus comprobaciones y arreglos (con la comprobación previa de `fixSafety.ts`), la elevación, las tareas y el mapa del cortafuegos; área «Configuración» en `npm run test:distros` (26/11: las 7 distros en verde). Límites: AppArmor solo se lee (los perfiles se ajustan a mano); no se cambia el puerto de SSH; SELinux nunca se desactiva del todo ni se activa desde aquí (hay que reetiquetar); «Arreglar» de una denegación solo con boolean, `semanage port` o `semanage fcontext` de una carpeta fuera del sistema (los volúmenes sin `:Z` solo se explican); las denegaciones se leen desde ayer (ausearch) o 24 h (journal), sin sudo puede faltar alguna; fail2ban se instala con el arreglo de la Auditoría, cuya cárcel `sshd` **no pone `port =`** cuando SSH no está en el 22 (el panel lo avisa; conviene arreglarlo en `checksSystem.ts`); openSUSE y Alpine: actualizaciones automáticas «no aplica»; en los contenedores de prueba no hay systemd, SELinux ni AppArmor, así que modo, denegaciones y temporizadores solo se probaron con salidas reales en las pruebas | Ver en un solo sitio cómo está configurado y protegido el servidor, en palabras simples y con «Arreglar» donde se pueda: **SELinux** (modo Enforcing/Permissive, denegaciones recientes `avc: denied` explicadas, booleans y contextos útiles para nginx/Caddy/contenedores) o **AppArmor** en Debian/Ubuntu, `sshd_config` (root, contraseñas, puertos), cortafuegos (enlace al del mapa), actualizaciones automáticas (`dnf-automatic`/`unattended-upgrades`), fail2ban, `sysctl` de red, usuarios con sudo, `hidepid`. La **Auditoría** ya comprueba parte: este panel es para **verlo y cambiarlo**, no solo puntuarlo; reutilizar sus comprobaciones y arreglos sin duplicar. |
| **12** | **«Cerrar puerto» que haga lo correcto según quién lo abre** | **Hecha (26/11), falta probar a mano** en un servidor con firewalld/ufw, Docker y Podman sin root. Botón «Cerrar…» en Puertos (fila y menú) y en el nodo de un puerto del mapa (`features/portClose/`, `components/PortClose/`). Límites: no cierra nunca el puerto de SSH; nftables/iptables solo se explican; «publicar solo en local» de un contenedor sin Compose solo se explica | Un puerto expuesto se cierra de formas distintas: (a) **bloquearlo en el cortafuegos** (sigue escuchando pero no se llega desde fuera); (b) **parar o desactivar el servicio** que escucha (systemd); (c) si es un **contenedor**: pararlo, o mejor publicar solo en local (`127.0.0.1:puerto:puerto`) o quitar el `ports:` del compose (con «Editar compose»). Ojo: Docker publica saltándose firewalld, así que ahí bloquear en el cortafuegos no basta; Podman sin root sí respeta el cortafuegos. En Puertos y en el mapa: botón «Cerrar…» que detecta quién abre el puerto y ofrece las opciones que funcionan de verdad, con vista previa de comandos y sin cortar tu SSH. |
| **13** | **Batería de pruebas por distro** | **Hecha (26/11)** · `npm run test:distros` (README, «Pruebas») | Contenedores efímeros (podman sin root) de Debian 12, Ubuntu 24.04, Alma 9, Rocky 9, Fedora 45, openSUSE Leap 15.6 y Alpine 3.20 con sshd, sudo y un usuario normal; se les pasan los scripts reales (usuarios, sesiones, puertos, monitor, distro, auditoría, cortafuegos, sitios web y el escáner) y los mismos parseadores. **Resultado: las 7 distros, 11 de 11 áreas bien** tras arreglar: (1) Usuarios y grupos no veía `useradd` en Debian, Ubuntu, Alma, Rocky, openSUSE y Alpine (está en `/usr/sbin`, fuera del PATH por SSH) y elegía los comandos de busybox; (2) la auditoría no leía las actualizaciones de openSUSE (zypper); (3) con sudo decía «necesita sudo» si no hay registro de entradas; (4) «1 carpeta personal es visibles». Sin systemd, «Servicios caídos» y «Reinicio pendiente» dicen bien que no se puede saber. Lo que no se pudo probar, en «Deuda técnica». |
| **—** | **Arrastre: archivos virtuales** | Aprobada (27/11), tanda 8 (última; solo se puede compilar y probar en la CI y en Windows/macOS reales) | Al arrastrar archivos grandes al escritorio, no copiarlos dos veces (`CFSTR_FILECONTENTS` en Windows, `NSFilePromiseProvider` en macOS). Quedarían fuera del motor de transferencias. |
| **—** | **Mapa de infraestructura (pulido visual)** | **Hecho (27/11), falta verlo en la app.** Estados con icono y texto, etiquetas recortadas al ancho, listas largas en «+N» (`features/infra/fold.ts`, `status.ts`, con pruebas), leyenda plegable, panel de detalles y «centrar en lo elegido». Comprobado con capturas de una página de prueba con datos de ejemplo (tema oscuro y claro). Límite: «bloqueado por el cortafuegos» no se marca en los puertos (exigiría leer el cortafuegos de cada servidor al abrir el mapa) | El zoom y navegación ya están hechos; solo pulido estético si se desea. |
| **5** | **Asistente corriendo dentro del VPS (`remote-control`)** | ❌ Descartado (16/11) | Sustituido por el punto 6 (la IA corre fuera del VPS para no gastar RAM ni exponer sesiones a root del VPS). |

Los números de la primera columna son los del historial (puntos 4–6 de «Próxima sesión», §7 «Ideas
recomendadas» y §8.2 «Gestión del servidor»).
