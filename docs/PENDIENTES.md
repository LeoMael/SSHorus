# SSHorus — Pendientes e ideas

Este archivo es **la lista única** de lo que falta y de las ideas abiertas. Al decir «continúa», empezar por el
resumen de abajo. Todo el detalle de las rondas anteriores (decisiones, diseño de cada función, pruebas y lo que
quedó sin verificar) está en el **[historial](historial/PENDIENTES-historial.md)**; ahí no se borra nada.

## Resumen al día

*Actualizado el 25/11/2026.*

Última versión etiquetada: **1.0.0-beta.3** (24/11/2026; Release en **borrador**, lo publica el usuario tras probarlo;
instalada en el PC del usuario como AppImage en `~/Applications`). Lo que está en `main` después de la beta.3 saldrá en
la **1.0.0-beta.4**.

**Estado al cerrar la sesión del 24/11/2026 (para retomar):**
- En `main` local, **sin subir** (saldrá en la beta.4): Compose (conflicto de nombres, tareas largas, editar el compose
  de otro usuario), Monitor → Por usuario con los UID de contenedores, barra lateral en árbol con la «S» de sudo,
  **tareas en segundo plano para toda la app** (ventanita en la esquina, ver en grande, cancelar; escáner,
  auditoría, actualizar imagen, reinicio y Compose) e ideas 9 y 10 anotadas.
- También en `main` sin subir: **emparejar asistentes de IA** (idea 10, fase 1: `sshorus-mcp pair`, permisos propios
  por asistente, revocar, puente copiado a `~/.local/bin`) y **fase 2, emparejar por OAuth** (idea 10b) con los
  arreglos de la revisión de la fase 1. No queda ningún agente en marcha.
- Pedir en BASE: que `stores/toasts.ts` y `Toaster` admitan un botón (hoy el aviso «Ver» de las tareas es propio de
  la esquina).
- **Aprobado por el usuario para la beta.4, sin empezar** (no lanzar más agentes hasta retomar): reglas de calidad
  automáticas en la CI, ver «Reglas automáticas de calidad» en la sección 3.
- Después: reglas automáticas de calidad, `/code-review` del lote, probar a mano lo de §2, versión `1.0.0-beta.4` (`bundle.windows.wix.version` →
  `0.6.0.4`), etiqueta y push (preguntar al usuario antes de subir).

### 1. Hecho en `main` (sin publicar todavía)
- **Administración → «Qué pueden ver»** + categoría `isolation` en **Auditar servidor** + casilla **«Permitir túneles SSH»** en «Nuevo usuario con clave» (apagada por defecto sin sudo).
- **Contenedores → «Al reiniciar»** siempre visible (y en Inspeccionar), linger inmediato, soporte de unidades como `podman-compose@*.service`, Podman de otros usuarios en `/tmp/sshorus-run-<uid>` y gestión de permisos en Usuarios → Contenedores.
- **Sitios web → «Tráfico»**: monitor bajo demanda para Caddy y nginx (`nice`/`ionice`, límite de 8 MB) con activación segura de log dedicado y rotación.
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
  contraseña de sudo configurada. Pendiente: nombre propio para el nodo (hoy muestra el host) y unir alias de
  `~/.ssh/config` que apuntan al mismo `HostName` (el perfil no guarda esa información).
- **Tareas en segundo plano para toda la app** (después de la beta.3): ventanita abajo a la derecha («2 tareas»),
  vista grande con salida en vivo, pasos, tiempos, Cancelar y «Copiar salida», historial de la sesión y aviso con
  «Ver». Van como tarea: Compose y Descargar imagen, Vulnerabilidades → Arreglar, Actualizar imagen, Auditoría →
  Arreglar / Arreglar todo lo seguro y Reiniciar ahora (sustituye al aviso flotante de abajo a la izquierda). Código:
  `features/jobs/` (lógica y ejecución), `stores/jobs.ts`, `components/Jobs/`.
- **Bases de datos (idea 9, solo lectura)**: pestaña nueva con el esquema de PostgreSQL, MySQL/MariaDB y SQLite (del
  servidor o de contenedores, también de otros usuarios con sudo), búsqueda, diagrama, «Copiar DDL» y credenciales
  guardables en la bóveda; MCP `get_db_schema`. Código: `features/databases/`, `components/Databases/`,
  `storage/db_secret.rs`, `mcp/core/db_schema.rs`. Falta probar a mano (§2).

Detalle de estas rondas: [historial, «Ronda de pruebas del 18–23/11» y «Ronda de orden del código»](historial/PENDIENTES-historial.md#próxima-sesión-anotado-el-13112026).

### 2. Pendiente inmediato (antes de publicar `1.0.0-beta.3`)
- **Probar a mano en la app real (`npm run tauri dev`) contra VPS reales**:
  - «Qué pueden ver» + arreglos automáticos + categoría `isolation` en Auditoría + crear usuario sin túneles.
  - Contenedores («Al reiniciar», linger, `podman-compose@*.service`) y Sitios web → «Tráfico» (Caddy y nginx con/sin log).
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

#### Reglas automáticas de calidad (aprobadas el 24/11/2026 para la beta.4)
Para que el orden no dependa de que cada agente se acuerde, la CI debe fallar si se rompe el criterio de
[`ARQUITECTURA.md` §5](ARQUITECTURA.md#dónde-va-cada-archivo-criterio-de-carpetas):
1. **Límites entre carpetas con ESLint** (`no-restricted-imports` o `eslint-plugin-boundaries`): `lib/` no importa
   `features/` ni `components/`; `features/` no importa interfaz salvo `components/ui`; `invoke()` solo en `src/api/`.
2. **Dependencias circulares** entre carpetas (p. ej. `dependency-cruiser`). Hoy quedan `stores` ↔ `connect`, `tmux`
   y `ui` (por `stores/sessionState.ts`): arreglarlas o dejarlas como excepción anotada.
3. **Tope de 500 líneas por archivo** con un script en la CI (también CSS), con lista de excepciones temporales para
   los que ya lo pasan (ver «Deuda técnica»), que solo puede encoger.
4. **Revisión de código antes de cada versión** (`/code-review` del lote) y anotar en el CHANGELOG lo que se arregló.
Documentarlo en `ARQUITECTURA.md` §5 y `dev/REGLAS-AGENTES.md` al hacerlo.

#### Deuda técnica (no bloquea la 1.0.0)
Medido el 24/11/2026 con `wc -l`, sin contar pruebas. Reglas de calidad en
[`dev/REGLAS-AGENTES.md`](dev/REGLAS-AGENTES.md) §5 y criterio de carpetas en
[`ARQUITECTURA.md` §5](ARQUITECTURA.md#dónde-va-cada-archivo-criterio-de-carpetas).
- **CSS de más de 500 líneas (11):** `Containers.css` (1221), `Commands.css` (1153), `MultiRun.css` (981),
  `Admin.css` (964), `theme.css` (817), `FileExplorer.css` (581), `Monitor.css` (572), `TransferPanel.css` (548),
  `Vulns.css` (540), `GitHub.css` (529), `SettingsDialog.css` (506).
- **Código entre 400 y 500 líneas (25):**
  - Interfaz: `Admin/ImageUpdateDialog.tsx` (494), `Terminal/termController.ts` (491), `Admin/KeyUserWizard.tsx` (487),
    `Containers/ContainersTab.tsx` (477), `Tabs/TabBar.tsx` (475), `Commands/CommandsPanel.tsx` (450),
    `Admin/VulnsTab.tsx` (445), `stores/transfers.ts` (439), `About/markdown.tsx` (434),
    `features/multirun/engine.ts` (426), `Containers/ImagesTab.tsx` (418), `Monitor/MonitorPanel.tsx` (416),
    `features/vulnscan/run.ts` (404), `features/monitor/sample.ts` (403), `Terminal/TerminalView.tsx` (403),
    `Admin/AdminPanel.tsx` (402).
  - Motor: `snippets/exec.rs` (472), `storage/secrets.rs` (455), `vulnscan/model.rs` (448), `types.rs` (446),
    `vulnscan/scripts.rs` (444), `vulnscan/analyze_merge.rs` (425), `mcp/bridge.rs` (413), `ssh/commands.rs` (410),
    `sftp/ops.rs` (409).
  - Justo en el límite (400): `vulnscan/analyze.rs`, `ai/mod.rs`, `Terminal/TerminalArea.tsx`.
- **`src/components/Admin` es demasiado grande:** 54 archivos TS/TSX (63 con CSS) y ~9.800 líneas. Partirlo por
  tema (usuarios, puertos y sitios, vulnerabilidades, auditoría…).
- **Menús contextuales repetidos:** `Sidebar/SbContextMenu.tsx` es casi igual a `ui/ContextMenu.tsx` (submenús y
  teclado); unificarlos. Y `components/Admin/ContextMenu.tsx` (uno más simple) se llama igual que `ui/ContextMenu.tsx`:
  pasarlo a `ui/ContextMenu` o renombrarlo.
- **`generatePassword` sigue en `features/admin/shell.ts`** aunque no es de Administración: pasarlo a `lib/`.
- **Ciclos entre carpetas:** `stores/sessionState.ts` importa de `features/connect`, `features/tmux` y
  `components/ui`, y estas importan de `stores/`. Romperlos (el estado de la app no debería depender de la lógica de
  una función).
- **La familia de la distribución se detecta en 3 sitios:** `features/containers/detect`, `features/tmux/logic` y
  `distroFromOs` (`features/commands/state.ts`). Dejar una sola versión en `lib/remote/` (junto a `parseOsRelease`).
- **Los comandos Tauri no siguen un criterio fijo:** unos están en `commands.rs` (`ssh/`, `storage/`, `mcp/`,
  `vulnscan/`, `storage/ssh_config/`), otros en `mod.rs` (`ai/`, `audit/`, `dragout/`, `github/`, `localkeys/`,
  `localterm/`, `sftp/`, `snippets/`, `sshkeys/`, `terminal/`, `transfer/`, `tunnels/`), en `github/sync_cmds.rs` y en
  archivos sueltos (`localfs.rs`, `diagnostics.rs`, `storage/lock.rs`, `storage/sudo_secret.rs`,
  `ssh/reboot_wait.rs`, `vulnscan/recheck.rs`, `mcp/rules.rs`, `localterm/state.rs`). Elegir una regla y aplicarla.
- **Solo 12 de las 27 carpetas de `src/features/` tienen `index.ts`** (`admin`, `audit`, `connect`, `containers`,
  `github`, `monitor`, `multirun`, `privileges`, `reboot`, `sudoRun`, `tmux`, `vulnscan`). Decidir si todas lo llevan.

### 4. Ideas y funciones futuras anotadas

| # | Idea / función | Estado | Resumen y siguiente paso |
|---|----------------|--------|--------------------------|
| **5a** | **Claude Code en la terminal del VPS con cuenta del PC** | Aprobada (16/11), sin empezar | Botón en terminal SSH con las dos opciones: «Copiar mi sesión» (estilo `copysse`) y «Llave de acceso» (`claude setup-token`), explicando la diferencia en una línea. Detalle en el [historial, punto 5a](historial/PENDIENTES-historial.md#próxima-sesión-anotado-el-13112026). |
| **5b** | **Despliegue asistido por IA vía MCP** | En diseño, sin empezar | Añadir `server_status` (CPU/RAM/disco reutilizando Panel de VPS), herramientas MCP de alto nivel (crear usuario, crear sitio Caddy/nginx, desplegar contenedor/servicio) y receta de despliegue (compilación local opcional). Detalle en el historial, punto 5b. |
| **4c** | **Auditoría extendida** | Anotada | «Auditar proyecto» (varios servidores a la vez) y auditar contenedores rootless de otros usuarios. |
| **4d** | **Auditoría programada** | Anotada | Repetir «Auditar servidor» cada cierto tiempo y avisar si algo empeora respecto a la anterior (historial, punto 4b). |
| **6** | **App móvil propia (APK aparte)** | Decidida (16/11), en prueba de viabilidad | Proyecto separado en Tauri 2 Android con Linux mínimo (`proot` + Debian por defecto / Alpine opcional) para correr Claude Code, Codex, agy y OpenCode con MCP local de SSHorus Móvil (SSH directo celular → VPS, sin PC en medio). Prototipo en `docs/movil/prototipo.html`. Siguiente paso: probar `proot-distro install debian` + instalador oficial en Termux. |
| **7.2** | **Servidor intermedio (jump host / bastión)** | Idea, sin empezar | Llegar a servidores internos pasando por otro (`ProxyJump`). Muy común en empresas. |
| **7.5** | **Sincronizar carpeta** | Idea, sin empezar | Carpeta local ↔ remota: al guardar en tu PC se sube sola (desarrollo web). |
| **7.7** | **Comparar archivos** | Idea, sin empezar | Diferencias entre un archivo local y uno remoto, o entre dos servidores. |
| **7.10** | **Historial por servidor** | Idea, sin empezar | Comandos usados en cada servidor y grabación opcional de sesiones (para auditoría). |
| **8.2+** | **Más Administración** | Idea, sin empezar | Servicios (systemd: iniciar, parar, activar, logs), firewall, paquetes (actualizar, instalar) y tareas programadas (cron/timers). |
| **9** | **Ver bases de datos (esquema)** | **Hecha (25/11), falta probar a mano** (ver §2). Pestaña «Bases de datos» + MCP `get_db_schema` | PostgreSQL, MySQL/MariaDB (servidor y contenedores, también de otros usuarios con sudo) y SQLite por ruta: bases, tablas, columnas, índices, claves foráneas, búsqueda, diagrama y «Copiar DDL»; entra sin contraseña (contenedor, `postgres`/root con sudo, tu usuario) o con usuario y contraseña guardables en la bóveda. Solo lectura. Siguiente (si se pide): MongoDB/Redis y ver unas filas de ejemplo. |
| **10** | **Emparejar asistentes de IA con «Aceptar / Rechazar»** | **Hecha (25/11), falta probar a mano** (ver §2). `sshorus-mcp pair`, permisos propios por asistente, revocar, puente en `~/.local/bin` | Conectar Claude Code, Codex, etc. al MCP sin copiar el token: registro sin secretos (`claude mcp add -s user sshorus -- sshorus-mcp`), la primera conexión pide permiso en SSHorus (quién es, carpeta, acceso por servidor), si se acepta SSHorus da un token propio de ese cliente que el puente guarda en el llavero; lista de asistentes emparejados con «Revocar» en Ajustes; solo 127.0.0.1, límite de peticiones, nada con SSHorus bloqueado, todo en `mcp-audit.jsonl`. Contexto: copysse usará SSHorus (ver `~/LEO/Projects/CLAUDE_COPY/docs/HOJA_DE_RUTA.md` §2). |
| **10b** | **Emparejar por OAuth (estándar del MCP) para clientes HTTP** | **Hecha (25/11), falta probar a mano** (ver §2) | `claude mcp add --transport http sshorus http://127.0.0.1:<puerto>/mcp` sin token: 401 → metadatos (RFC 9728/8414) → documento de metadatos del cliente o registro dinámico → navegador «Vuelve a SSHorus para aceptar» → el mismo diálogo de la fase 1 → código (PKCE S256, 60 s, un uso) → token de acceso de 1 h ligado al recurso y de renovación que rota. Misma lista de asistentes («HTTP (OAuth)»), «Cambiar permisos» y «Revocar». Código en `mcp/oauth/` (ver ARQUITECTURA). Sin probar aún con Claude Code y Codex reales. |
| **—** | **Arrastre: archivos virtuales** | Solo si hace falta | Al arrastrar archivos grandes al escritorio, no copiarlos dos veces (`CFSTR_FILECONTENTS` en Windows, `NSFilePromiseProvider` en macOS). Quedarían fuera del motor de transferencias. |
| **—** | **Mapa de infraestructura (pulido visual)** | Opcional | El zoom y navegación ya están hechos; solo pulido estético si se desea. |
| **5** | **Asistente corriendo dentro del VPS (`remote-control`)** | ❌ Descartado (16/11) | Sustituido por el punto 6 (la IA corre fuera del VPS para no gastar RAM ni exponer sesiones a root del VPS). |

Los números de la primera columna son los del historial (puntos 4–6 de «Próxima sesión», §7 «Ideas
recomendadas» y §8.2 «Gestión del servidor»).
