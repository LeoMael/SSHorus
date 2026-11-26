# Historial de cambios

Todos los cambios importantes de SSHorus se anotan aquí.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones
siguen [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido
- **Bases de datos (solo lectura)**: pestaña nueva en cada servidor para ver el esquema de **PostgreSQL**,
  **MySQL/MariaDB** y **SQLite**. Encuentra sola las bases del servidor (por sus puertos y sockets) y las que corren
  en **contenedores** (los tuyos y, con sudo, los de root y de otros usuarios); los archivos SQLite se añaden con su
  ruta (no se busca por el disco). Entra sin contraseña cuando puede (dentro del contenedor, como `postgres` o root
  con sudo, o como tu usuario); si no, pide usuario y contraseña y puede **guardarlos** en la bóveda o el llavero para
  esa base. Muestra bases con su tamaño, tablas y vistas con filas aproximadas y tamaño, columnas (tipo, nulo, valor
  por defecto, clave primaria), índices y claves foráneas, con **búsqueda**, un **diagrama** de relaciones y
  **Copiar DDL**. Las consultas solo leen (`pg_catalog`, `information_schema`, `sqlite_master`) con límite de tiempo,
  y la contraseña va por la entrada estándar: nunca en la línea de comandos ni en los registros.
- **Asistentes de IA: `get_db_schema`** devuelve ese mismo esquema (lectura, pasa sola), con la credencial guardada o
  sin contraseña y sin sudo. La IA nunca ve contraseñas.
- **Mapa: el cortafuegos enseña sus reglas en palabras simples.** Clic en el cortafuegos del mapa: a la derecha
  ves su estado, qué pasa con lo que no encaja en ninguna regla y cada regla en una frase («Permite entrar por TCP
  443 (HTTPS) desde cualquier sitio»); clic en la frase para ver la regla original. Sirve para firewalld (zonas,
  servicios, puertos, reglas enriquecidas, redirecciones y NAT), ufw, nftables e iptables. Las reglas que crean
  Docker y Podman van aparte («no tocar a mano»). Avisa si un puerto **escucha pero el cortafuegos lo bloquea**, si
  hay algo **abierto sin nada escuchando** y si Docker publica un puerto saltándose el cortafuegos. Sin sudo
  explica qué falta y deja escribir la contraseña.
- **Mapa: cambiar el cortafuegos sin quedarte fuera** (firewalld y ufw; nftables e iptables, de momento solo se
  ven): **Abrir puerto o servicio** (TCP/UDP, rango y, si quieres, solo para una IP o red), **Quitar** una regla y
  **Activar** el cortafuegos apagado. Antes de aplicar enseña los comandos exactos. SSHorus no deja quitar la regla
  por la que entra tu conexión SSH, al activar abre antes el puerto de SSH y, si el cambio toca el acceso, lo aplica
  **a prueba**: prueba a entrar con una conexión nueva (si no puede, lo deshace enseguida) y, si en 5 minutos no
  pulsas **Hacer permanente** (firewalld) o **Mantener** (ufw), el servidor lo deshace solo. Va como tarea en
  segundo plano.
- **Mapa más claro**: panel de detalles con el icono y el estado del nodo, leyenda plegable con todos los tipos y
  colores, el cortafuegos apagado también aparece (en amarillo, «apagado») y los nodos se recorren con el teclado
  (Tab, Intro para ver los detalles, Esc para cerrarlos).
- **Tareas en segundo plano para toda la app**: lo que tarda sigue aunque cierres el diálogo que lo lanzó o cambies de
  pestaña. Abajo a la derecha aparece una ventanita con cuántas hay en marcha («2 tareas»); al pulsarla ves cada una
  (servidor, en qué va, tiempo, progreso si se sabe, **Ver** y **Cancelar**). **Ver** la abre en grande: salida en
  vivo, pasos, hora de inicio y de fin, resultado, **Cancelar** y **Copiar salida**. Las terminadas se recuerdan hasta
  cerrar SSHorus (o **Vaciar historial**) y al terminar sale un aviso con **Ver**. Si una tarea lleva un minuto sin
  escribir nada, lo dice. **Cancelar** detiene el proceso también en el servidor, con el mismo usuario que lo lanzó
  (root con sudo o el dueño de los contenedores).
- Van como tarea: Compose («Levantar», «Actualizar», «Aplicar cambios») y **Descargar imagen** (el botón **Tareas** de
  Contenedores abre la lista con solo las de ese servidor); **Vulnerabilidades → Arreglar / Arreglar todo lo que tiene
  solución** (antes la ventana se quedaba cargando mientras `dnf upgrade` trabajaba; ahora se ve la salida en vivo y,
  con dnf, cuántos paquetes lleva), **Actualizar imagen** (descarga, Compose y systemd), **Auditoría → Arreglar y
  Arreglar todo lo seguro**, y **Reiniciar ahora** con sus pasos (reiniciando, esperando a que vuelva, conectado de
  nuevo) y **Dejar de esperar**.
- **Asistentes de IA: conectar con «Aceptar / Rechazar», sin copiar secretos.** Dile a tu IA «conéctate a SSHorus
  ejecutando `sshorus-mcp pair`»: SSHorus muestra quién lo pide (programa, PID y carpeta), eliges sus permisos por
  servidor (Sin acceso / Solo lectura / Completo) y aceptas. La IA guarda su llave en el llavero del sistema y se
  apunta sola en su configuración (Claude Code, Codex y Gemini CLI; para OpenCode y Antigravity muestra el bloque
  exacto). Varias IA a la vez, cada una con **sus propios permisos**, y en **Ajustes → Asistentes de IA → Asistentes
  conectados** ves su carpeta y último uso, con **Cambiar permisos** y **Revocar**. Peticiones, respuestas,
  revocaciones e intentos con una llave revocada quedan en el registro del asistente. Límite: una petición
  esperando por asistente y 3 por minuto. La conexión manual con token sigue funcionando igual.
- **Asistentes de IA por HTTP directo, sin token: emparejar con la autorización estándar de MCP (OAuth).**
  `claude mcp add --transport http sshorus http://127.0.0.1:<puerto>/mcp` (está listo para copiar en **Asistentes
  conectados**): al usarlo, el asistente abre el navegador con «Vuelve a SSHorus para aceptar» y SSHorus muestra el
  mismo aviso de **Conectar un asistente** (con su identidad, el navegador y a dónde vuelve). Si aceptas, recibe un
  acceso que dura una hora y se renueva solo; si rechazas, se le dice que no. Queda en la misma lista, marcado
  **HTTP (OAuth)**, con **Cambiar permisos** y **Revocar** (que corta también la renovación). Sirve para clientes con
  documento de metadatos (Claude Code) y con registro dinámico (Codex y otros). Solo en 127.0.0.1, PKCE obligatorio,
  códigos de un solo uso (60 s), todo en el registro del asistente, y nada funciona con SSHorus bloqueado.
- **Puente en ruta fija**: SSHorus copia `sshorus-mcp` a `~/.local/bin` (Windows: `%LOCALAPPDATA%\SSHorus\bin`) al
  abrirse, así las configuraciones no se rompen con la AppImage.
- **Compose: «Ya existe un contenedor con ese nombre»** ahora tiene arreglo: **Ver y arreglar** muestra el contenedor
  viejo (id, imagen, estado, fecha, de qué proyecto o herramienta viene y sus volúmenes) y los del mismo origen que
  chocarían después, y **Reemplazar el contenedor viejo y volver a intentarlo** los para y los borra como su dueño
  (sin borrar volúmenes) y repite la tarea. Si hay datos que se pueden perder (volumen anónimo, datos dentro del
  contenedor), avisa en rojo y pide marcar una casilla.
- **Compose: «Editar compose»** abre el archivo en el editor como su dueño (con sudo si es de otro usuario): guarda
  encima conservando dueño, grupo y permisos, con copia `.bak-sshorus-<fecha>` la primera vez, y luego **Aplicar
  cambios (up -d)**. **Abrir carpeta** lleva a **Archivos** en la carpeta del proyecto.
- **Compose: «Actualizar»** tiene la opción de volver a construir las imágenes propias (`up -d --build`).
- **Monitor → Por usuario: los números de los contenedores dicen qué son.** Los uid sin nombre de Podman sin root
  (p. ej. `590822`) salen como «Contenedor seguimiento-siu-db · de leo_oti · uid 999 dentro», debajo de su dueño. El
  dueño sale de `/etc/subuid`, el contenedor del cgroup de cada proceso y el nombre de su `conmon` (sin sudo; cada
  proceso se lee una sola vez). Al elegir la fila, una nota explica qué es, si se puede cerrar y **Ver en
  Contenedores** abre los de ese dueño. En **Procesos**, cada proceso de un contenedor lleva su nombre y «Terminar»
  avisa de que puede dejar el contenedor a medias.
- **Barra lateral: cuentas del mismo servidor juntas.** Si guardas varios usuarios del mismo servidor (mismo host y
  puerto), salen bajo un nodo plegable con el host, cuántas cuentas hay y un punto verde si alguna está conectada.
  La cuenta con sudo (o root) va primero y lleva una **S**; se sabe por la última vez que te conectaste con ella o,
  si nunca te conectaste, por su contraseña de sudo configurada. También dentro de cada proyecto.

- **Contenedores → Imágenes: elegir varias.** Casillas en cada fila y «Elegir todas» (también con el teclado:
  `Espacio` marca, `Ctrl+A` todas las visibles, `Supr` elimina, `Intro` abre los detalles). **Eliminar** las elegidas
  muestra la lista antes; las que usa algún contenedor (aunque esté parado) se quedan, salvo que marques **Forzar**,
  que avisa de lo que pasa (en Podman también borra esos contenedores). Las imágenes con varios nombres se borran sin
  `-f`. **Detalles** de cada imagen: sistema, con qué arranca, puertos, variables, etiquetas y **qué contenedores la
  usan** (con atajo a Inspeccionar).
- **Contenedores: «Que arranque solo» para proyectos de podman-compose.** Antes, un contenedor como
  `seguimiento-siu-db` (de `podman-compose@seguimiento_siu.service`) acababa en «No hay nada que cambiar desde aquí».
  Ahora SSHorus mira, como el dueño y por sus archivos (aunque su systemd de usuario esté parado), si están la
  plantilla `podman-compose@.service`, el registro del proyecto (`~/.config/containers/compose/projects/<p>.env`), el
  servicio habilitado y el linger, y te propone el camino: **activar el servicio** (`systemctl --user enable --now`,
  más linger con sudo si falta) o **prepararlo** antes (`podman-compose systemd -a create-unit` en la carpeta de
  servicios del usuario y `-a register` desde la carpeta del proyecto). Si no hay podman-compose (solo el plugin
  docker-compose) o sus contenedores no están en un pod, propone la otra forma: **política de reinicio** +
  `podman-restart.service` + linger, con **Editar compose…** para poner `restart:` en el archivo (con copia). Se ven
  los comandos exactos antes, va en segundo plano y al terminar se vuelve a leer y se dice el estado nuevo.

### Corregido
- **Contenedores → Imágenes: «Limpiar sin usar» ya no se queda gris sin decir por qué.** Con «Todos» (admin viendo
  los contenedores de otros usuarios) el botón estaba desactivado y el motivo solo salía en un aviso flotante que no
  aparece en un botón desactivado. Ahora funciona también con «Todos» (limpia como cada usuario) y, si de verdad no se
  puede, lo dice debajo («Desactivado porque todas las imágenes las usa algún contenedor»…). Antes de limpiar enseña qué
  se borra y cuánto espacio se libera; por defecto solo las «sin nombre», con la opción de incluir las que tienen
  nombre (explicado en simple). Va en segundo plano.
- **Contenedores → «Al reiniciar»: «Sin datos» explica el motivo** (no se pudo leer y por qué, o falta actualizar) en
  vez de quedarse en blanco o con la etiqueta sola.
- **Sitios web → «Tráfico»: activar el registro de visitas funciona en Caddy y nginx, también con SELinux.**
  Probado con Caddy 2.6 (EPEL, Rocky 9, systemd), Caddy 2.11 y nginx 1.20 (Rocky 9). Lo que fallaba:
  - **Caddy 2.7+ que corre como su usuario** (paquete oficial): `caddy validate` (como root) creaba el registro con
    dueño root y permisos 600, Caddy no podía abrirlo al recargar, se deshacía el cambio con el mensaje equivocado
    («no pasó la validación») y cada intento volvía a fallar. Ahora la carpeta y el archivo son del usuario de Caddy
    antes de validar (y se arregla el archivo que dejó un intento anterior).
  - **«Guardar en archivo…»** en un sitio de Caddy con `log` propio que iba al diario siempre fallaba («ya tiene una
    directiva log»): ahora se sustituye (y queda comentado para poder volver atrás).
  - **nginx**: si un `location` tenía `access_log off;` (lo típico para CSS/JS), el registro nuevo se ponía dentro de
    ese `location` y solo guardaba los estáticos. Ahora va en el `server` del sitio. Activar dos veces ya no repite
    la línea.
  - **Detección**: en Caddy 2.6 con puerto propio («sitio:8081») o con un registro común y otro propio a la vez, el
    sitio seguía saliendo «sin activar» o «compartido» después de activarlo.
  - El archivo editado conserva su dueño, sus permisos, su contexto SELinux y los enlaces de `sites-enabled` (antes se
    sustituía por un archivo nuevo).
  - Con **SELinux** activo, si el servidor web corre como `httpd_t`, la carpeta del registro pasa a `httpd_log_t`
    (`semanage fcontext` + `restorecon`, o `chcon`). Si algo lo bloquea, el error trae las líneas `avc: denied`.
  - Ahora es una **tarea en segundo plano** con sus pasos a la vista: revisar (si la configuración ya tenía un error,
    lo dice y no toca nada), copia en `/var/backups/sshorus`, carpeta, editar, validar, recargar y una **visita de
    prueba** que comprueba que la petición aparece en el registro. Si algo falla o se cancela antes de recargar, el
    archivo vuelve a quedar como estaba. El error dice qué paso falló y la línea de `nginx -t` o de Caddy.
  - Nuevo **«Quitar registro…»**: deja el sitio como estaba (vuelve el `access_log off;` o el `log` de antes).
  - La lectura del tráfico suma los archivos rotados (`.1`, `.gz` de logrotate y los de Caddy) si caben en el tope
    de 8 MB, dice «todavía no ha recibido visitas» con el registro vacío y no cuenta la visita de prueba con «Sin bots».
- **Monitor → Por usuario**: la marca «tú» ya no queda pegada al nombre («leotú») y la tabla explica sus columnas.
- **Vulnerabilidades: lo arreglado ya no vuelve a salir en Rocky y AlmaLinux.** A OSV se le preguntaba la versión sin
  epoch y Rocky/Alma escriben la versión arreglada con él («1:3.2.2-6.el9_5»): OSV daba por pendientes, para siempre,
  los avisos de todo paquete con epoch (openssl, vim, grub2, shadow-utils, perl, bind…) aunque ya estuvieran
  actualizados, también después de reiniciar. Ahora cada aviso se vuelve a comprobar con la versión completa
  instalada, comparada como lo hace `rpm` (epoch, `~`, `^`, «el9_4» < «el9_5»).
- **Vulnerabilidades: el resultado de «Arreglar» dice la verdad, paquete por paquete**: Arreglado / Instalado, falta
  reiniciar servicios / Instalado, falta reiniciar el servidor / Sin versión corregida en tus repos todavía /
  Actualizado, pero sigue afectado / Falló, con la línea de dnf que lo explica (excluido, conflicto, no encontrado).
  «Nothing to do» (código 0) ya no cuenta como arreglado: si no se instaló nada, la tarea termina como fallida.
- **Vulnerabilidades: «Aún no en tus repos»**: con dnf/yum el análisis mira también `check-update`; lo que tiene
  versión corregida publicada pero que tus repositorios todavía no traen va en su propio grupo y no ofrece
  «Arreglar» como si fuera a funcionar (el comando sigue en el detalle para copiarlo).
- **Vulnerabilidades: «Por qué sigue apareciendo»** en el detalle de cada una: kernel nuevo instalado pero en uso el
  viejo, arranque por defecto que no cambió (con el comando de `grubby`), versión que tus repositorios aún no
  traen (y cómo comprobarlo), imagen de contenedor, programa suelto o informe de antes.
- **Vulnerabilidades: informe de antes de un reinicio**: si el servidor se reinició (o cambió el kernel en uso)
  después del análisis que se ve, sale un aviso con **Volver a comprobar**. El análisis avisa también si al reiniciar
  arrancaría otra vez el kernel viejo (`grubby --default-kernel`).
- **Tareas en segundo plano**: al **Cancelar**, la tarea ya no sigue con lo de después (en «Arreglar» del escáner
  volvía a comprobar durante minutos; en la auditoría el arreglo cancelado quedaba como fallido). Compose detiene en
  el servidor lo que se pasa de tiempo. Sin `setsid` en el servidor, **Cancelar** para todo el árbol de procesos (y
  avisa si no pudo). En Auditoría, los resultados de un arreglo ya no se mezclan con otro informe abierto.
- **Asistentes conectados → Cambiar permisos**: un asistente sin acceso a nada ya no pasa a «Solo lectura» en todos
  los servidores al darle acceso a uno.
- **Aceptar automáticamente** se puede usar en un servidor donde un asistente conectado tiene **Completo** aunque la
  conexión con token no tenga acceso, y vale solo para quien tenga Completo o Solo lo marcado ahí.
- El servidor MCP rechaza las peticiones que no sabe de quién son (antes usaban los permisos de la conexión con
  token) y las páginas que se hacen pasar por otro nombre de equipo («DNS rebinding»).

### Cambiado
- El aviso flotante de **Reiniciar ahora** (abajo a la izquierda) pasa a ser una tarea más de la ventanita de abajo a
  la derecha, que se abre sola al empezar.
- **Cancelar** en «Arreglar» del escáner y de la auditoría ahora detiene de verdad lo que corre como root (antes se
  cortaba la conexión, pero `dnf` o `apt` podían seguir en el servidor).
- **Desarrollo:** la CI comprueba sola el orden del código (límites entre carpetas, ciclos entre carpetas y tope de
  500 líneas por archivo); `npm run check` hace lo mismo en local.

## [1.0.0-beta.3] - 2026-11-24

### Añadido
- **«Reiniciar ahora»**: reinicia el servidor con sudo desde SSHorus (escáner de vulnerabilidades, auditoría y Panel
  de VPS), espera hasta 5 minutos a que vuelva, reconecta todas sus sesiones y comprueba que efectivamente arrancó
  de nuevo.
- **MCP: `reboot_server`**: el asistente puede reiniciar un servidor de forma segura (pide permiso siempre, avisa al
  vigilante de reconexión y envía el reinicio con sudo).
- **Contenedores → columna «Al reiniciar»** (siempre visible, también en Inspeccionar): muestra si cada contenedor está
  «Activado» o «No activado» para levantarse solo tras un reinicio del servidor (política, `podman-restart.service` /
  `docker.service`, unidad Quadlet/systemd como `podman-compose@*.service` y linger), con acciones por fila y en lote
  para activarlo o desactivarlo.
- **Administración → Sitios web → «Tráfico»**: monitor de visitas y tráfico bajo demanda por cada sitio de **Caddy** o
  **nginx** (peticiones, IPs aproximadas, bytes transferidos, desglose 2xx/3xx/4xx/5xx, gráfica horaria/diaria con
  tabla accesible, rutas más visitadas, IPs, orígenes y últimas peticiones). Pensado para servidores de 1 vCPU (sin
  consultas automáticas en segundo plano, `nice -n 19` + `ionice -c3`, límite de 8 MB desde el final y timeout de 15 s).
  Si el sitio no tiene log activado o usa uno compartido, permite activar un registro dedicado con rotación automática
  tras validar la configuración (con copia de respaldo y restauración si falla).
- **Administración → Usuarios → «Contenedores»**: columna con etiquetas de Podman, linger y Docker, y diálogo para
  dar o quitar permisos de contenedores y activar/quitar linger por usuario.
- **Administración → «Qué pueden ver»** (y nueva categoría en **Auditar servidor**): muestra por cada usuario sin sudo
  qué puede ver o alcanzar (túneles SSH, servicios en `127.0.0.1` avisando de los que suelen ir sin contraseña, `/proc`
  sin `hidepid`, carpetas `HOME` ajenas, configuración web, `cron`/logs y acceso a Docker o contenedores de otros), con
  nota y botón **«Arreglar»** mostrando antes los comandos exactos. En **«Nuevo usuario con clave»**, casilla
  **«Permitir túneles SSH»** apagada por defecto cuando no tiene sudo.
- **Terminal**: botón de llave para escribir la contraseña de sudo solo cuando la terminal la pide (previa
  confirmación de PIN).
- **MCP: `run_with_password`**: para programas que piden una contraseña por su cuenta (`passwd`, `su`, `mysql -p`,
  `ssh-keygen -p`, `docker login`, `git` por HTTPS…). SSHorus siempre te pregunta (con el comando y el motivo de la IA):
  eliges la contraseña guardada del servidor (opción por defecto), escribes otra o no lo permites. SSHorus la escribe
  cuando el programa la pide y la IA solo ve la salida, con la contraseña tapada (`••••`). Si el programa vuelve a
  pedir la misma (contraseña incorrecta), se detiene para no repetir intentos.

### Cambiado
- **MCP: la IA usa las contraseñas pero nunca las ve**. «Permitir que la IA pida ver la contraseña de sudo»
  (`request_sudo_password`) ahora viene **apagado** y, apagado, la herramienta ni se anuncia. Si lo tenías encendido
  sin haberlo tocado (antes venía así), queda apagado: puedes volver a encenderlo en Ajustes → Asistentes de IA.
- **MCP: más protección de contraseñas**: si la salida de un comando o un archivo muestra una contraseña guardada del
  servidor (de 6 caracteres o más), se tapa; y `upload` no deja subir llaves privadas SSH (`~/.ssh`, la llave de cada
  servidor) ni la carpeta de configuración de SSHorus.
- **MCP → «Aceptar automáticamente»**: el indicador de la barra de pestañas abre una ventana con el detalle por
  servidor, botón «Apagar» por fila y «Apagar todo» con confirmación.
- **Orden del código (partes 1, 2 y 3) y ESLint**: añadida configuración de **ESLint** (`npm run lint`, **0 errores y 0 warnings**),
  `cargo clippy` con **0 warnings**, `src/features/` organizado 100 % en subcarpetas por dominio (sin archivos sueltos en
  raíz) y divididos todos los archivos > 500 líneas en módulos pequeños y cohesivos (TS/TSX: `FileExplorer`, `SessionView`,
  `ServerEditor`, `SettingsDialog`, `Sidebar`, `ContainersPanel`, `ContainersTab`, `ComposeTab`, `containers/parse.ts`,
  `TransferPanel`, `VulnsTab`, `AdminPanel`, `WebTab`, `CommandsPanel`, `Commands/catalog.ts`, `ResultsView`,
  `termController.ts`, `SyncSection`, `audit/checks.ts`, `admin/web.ts`, `admin/userVisibility.ts`, `infra/graph.ts`,
  `vulnscan/imageUpdate.ts`; Rust: `transfer/{engine,copy}.rs`, `mcp/{core,mod}.rs`, `storage/{ssh_config,mod}.rs`,
  `ssh/{connect,known_hosts}.rs`, `tunnels/manager.rs`, `github/{api,mod}.rs`, `vulnscan/{analyze,osv}.rs`).
- **«Nuevo usuario con clave»**: la lista de llaves de `~/.ssh` solo muestra llaves públicas `.pub` válidas (el
  asistente y GitHub leen ahora las llaves con el mismo código).
- **Orden del código (parte 4)**: funciones compartidas sin copias (`src/lib/remote/`, ejecución con elevación en
  `features/privileges/run.ts`) y un criterio fijo de carpetas: la lógica de Comandos, del explorador y del panel de
  Contenedores pasa a `src/features/`, los controles comunes a `components/ui/` y el estado de las sesiones a
  `stores/`. Detalle en `docs/ARQUITECTURA.md` §5.
- **Pruebas**: nuevo `npm test` (todas las pruebas de la interfaz, o `npm test -- <filtro>`); la CI ejecuta además
  ESLint (0 avisos) y `npm test` en Linux y en Windows.

### Corregido
- **Terminal**: escritura sin retraso (`TCP_NODELAY` y envío inmediato tras pausa), texto insertado visible al momento,
  y al reconectar tras un reinicio distingue si volvió a la sesión tmux existente o abrió una nueva.
- **Contenedores (Podman)**: los contenedores de otros usuarios sin sesión activa funcionan con carpeta propia en
  `/tmp/sshorus-run-<uid>`; aviso y botón «Arreglar» si Podman apunta a las carpetas de root; el aviso de linger
  desaparece al instante al activarlo desde cualquier acción del panel.
- **IA para explicar informes**: si el modelo o proveedor (p. ej. Claude con thinking o modelos de razonamiento)
  rechaza el parámetro `temperature`, se reintenta automáticamente sin él.
- **Confirmaciones**: los diálogos ya quedan siempre encima de Ajustes.
- **Sitios web → «Comprobar configuración»** ya no se repite sola al escribir la contraseña de sudo: se ejecuta una
  vez al abrir.
- **Transferencias**: la lista de un lote grande va más fluida (ya no se vuelve a filtrar cada segundo).
- **Barra lateral → «Mostrar servidor»**: funciona también al mover un servidor a un proyecto (espera a que la fila
  aparezca) y, si no llega a aparecer, deja de buscarla en vez de robar el foco más tarde.

## [1.0.0-beta.2] - 2026-11-16

### Importante
- **Primera versión publicada con el nombre SSHorus.** La 1.0.0-beta.1 no llegó a publicarse: todo lo suyo viene
  también aquí. **Si vienes de TerView**, lee «Importante» en [1.0.0-beta.1](#100-beta1---2026-11-14): esta vez hay
  que instalarla a mano (TerView no la ve como actualización) y los servidores, ajustes y contraseñas no se traen.

### Añadido
- **Terminal local → «Asistente con contexto»**: abre Claude Code, Codex, agy u OpenCode en esa misma
  terminal, en la carpeta donde estás, con el contexto de SSHorus y el MCP. Al salir del asistente vuelves a
  la shell tal como estaba. También **«Copiar contexto»** (sin contraseñas, llaves ni tokens).
- **MCP: la IA puede pedir la contraseña de sudo** (`request_sudo_password`). SSHorus siempre te pregunta,
  con el motivo y el aviso de que quedará en la conversación; sin «Permitir siempre» y «Aceptar
  automáticamente» no la salta. Se puede apagar en Ajustes → Asistentes de IA.
- **Vulnerabilidades → «Arreglar todo lo que tiene solución»**: un solo comando con sudo, salida en vivo,
  «Cancelar» y al final «Arreglado: N · Siguen: M» con el motivo de lo que sigue. Se separa lo que se
  arregla ya, lo que solo necesita reiniciar y lo que aún no tiene arreglo, y hay «Volver a comprobar».
- **Auditoría → «Arreglar»** en cada problema y **«Arreglar todo lo seguro»**. Lo que puede dejarte fuera
  (quitar la contraseña, prohibir root, cortafuegos) va aparte, con aviso y una comprobación previa. Los
  problemas salen por importancia y los que no tienen comando dicen qué hacer.

- **MCP: permisos por tarea en cada servidor.** Nuevo nivel **«Solo lo marcado»** con casillas: usuarios (crear,
  editar y borrar por separado), sitios web (Caddy y nginx), contenedores, servicios, paquetes, cortafuegos,
  archivos (solo en las carpetas que elijas) y comandos libres (apagado por defecto; si lo enciendes, las casillas
  ya no limitan). La IA usa sudo solo para lo marcado, y «Aceptar automáticamente» también funciona ahí, solo dentro
  de lo marcado. Plantillas: «Solo usuarios», «Solo web», «Despliegue» y «Todo».
- **MCP: usuarios protegidos** (por servidor y una lista para todos, por ejemplo `root`): la IA no puede editarlos,
  borrarlos, escribir en su carpeta ni actuar como ellos. Con comandos libres, si un comando los menciona, SSHorus
  pregunta siempre y lo avisa.
- **Ajustes → Asistentes de IA:** resumen de qué puede hacer la IA en cada servidor y «Aplicar a varios servidores»
  (elegidos o un proyecto entero).
- **Biblioteca:** añadir o quitar de un grupo, cambiar el shell, bloquear, desbloquear y borrar usuarios; crear,
  cambiar el puerto, borrar, probar y recargar sitios de Caddy y nginx (si la configuración no valida, se deja como
  estaba).
- **Usuarios → «Nuevo usuario con clave» con «Dar sudo»**: le pone una contraseña que solo sirve para sudo
  (generada o escrita), la muestra una vez con «Copiar» y SSHorus la guarda como sudo «Guardar» del servidor.
  Sigue entrando solo con su llave: sshd queda «solo llave» para ese usuario (comprobado con `sshd -t`; si falla,
  se deshace). Sin sudo sin contraseña.

### Cambiado
- Terminal: Ctrl+C copia si hay texto seleccionado; al copiar no se arrastran espacios al final de las
  líneas; aviso antes de pegar varias líneas que se ejecutarían.

### Corregido
- Terminal: los emojis y símbolos ya no descuadran el texto (letras juntas o que saltan de línea), sobre
  todo con Claude Code y otros asistentes. Vale también para la terminal de los servidores.
- Vulnerabilidades y auditoría: **lo arreglado desaparece** del informe y del historial. Antes no se volvía
  a comprobar nada; además los kernels viejos que quedan instalados seguían contando.
- Auditoría: arreglos que no cambiaban lo que mide la comprobación (actualizaciones retenidas en
  Debian/Ubuntu, recargar sshd sin systemd, `hidepid` que se perdía al reiniciar, cortafuegos con el puerto
  real de SSH, fail2ban en Alpine). Si `sshd -t` falla, se recupera la configuración anterior.
- MCP: si SSHorus se bloquea mientras espera la contraseña de sudo, no se ejecuta nada; la contraseña
  guardada se usa sin abrir el diálogo; mensajes más claros para la IA (sudo no instalado, root, diálogo
  cancelado).

## [1.0.0-beta.1] - 2026-11-14

### Importante
- **La app se llama ahora SSHorus** (antes TerView), con logo nuevo: el ojo de Horus dentro de un anillo,
  con la terminal `>_`. Para el sistema es otra app, así que **no se traen los datos de TerView** y esta vez
  hay que instalarla a mano (la TerView instalada no la ve como actualización):
  - **Servidores, proyectos, ajustes, comandos propios, túneles y PIN empiezan vacíos.** Vuelve a añadir los
    servidores o impórtalos con **Importar `~/.ssh/config`** (los que exportaste desde TerView están en su
    bloque `# >>> TerView … >>>`; después de importarlos puedes borrar ese bloque).
  - **Las contraseñas guardadas no se pasan**: vuelve a escribirlas. Las de TerView siguen en el llavero del
    sistema (servicio `terview`) y se pueden borrar desde su gestor de contraseñas.
  - Carpetas nuevas: `~/.config/sshorus/` y `com.sshorus.app` (antes `~/.config/terview/` y
    `com.terview.app`). Las de TerView se pueden borrar a mano.
  - **Asistentes de IA (MCP)**: el servidor se llama `sshorus`, el puente `sshorus-mcp` y las variables
    `SSHORUS_MCP_TOKEN` / `SSHORUS_MCP_PORT`. Vuelve a añadirlo desde Ajustes → Asistentes de IA y quita el
    `terview` viejo de Claude Code, Claude Desktop o Codex.
  - Las terminales tmux que dejó TerView en los servidores (`terview-…`) ya no se recuperan solas, la copia
    sincronizada de GitHub empieza de cero (`sshorus-sync.json`) y los comandos exportados con TerView no se
    importan.
  - En Linux, desinstala el paquete viejo con `sudo dnf remove ter-view` o `sudo apt remove ter-view` (el
    nuevo se llama `ss-horus`); en Windows, desde Configuración → Aplicaciones.
  - El repositorio pasa a [github.com/LeoMael/SSHorus](https://github.com/LeoMael/SSHorus) y de ahí salen las
    actualizaciones automáticas. Las versiones de TerView no publicaban `latest.json` (faltaba la llave de
    firma en GitHub), por eso la app nunca encontraba versiones nuevas.

### Añadido
- **Escáner → «Actualizar imagen»**: en las vulnerabilidades de una imagen de Podman o Docker, un botón
  que la actualiza de verdad y dice qué contenedores se recrean. Lee en el momento cómo se creó cada
  contenedor: si es de **Compose**, hace `compose pull` y `compose up -d` en su carpeta; si lo arranca
  **systemd/Quadlet**, descarga la imagen y reinicia la unidad; si se creó **a mano**, descarga la imagen
  y abre el formulario «Nuevo contenedor» ya relleno para reemplazarlo (si el nuevo no arranca, vuelve el
  viejo). Antes muestra los comandos exactos y pide confirmación; se ejecuta como el dueño de la imagen,
  con su salida y «Cancelar». Al terminar vuelve a analizar esa imagen y avisa si todavía tiene
  vulnerabilidades.
- **Terminal local** («Este equipo»): pestañas con una terminal **de tu propio PC**, junto a las de los
  servidores. Misma terminal que las de SSH (tema, búsqueda, copiar/pegar, tamaño). Se abren con el botón
  del portátil en la barra de pestañas, desde «+» o desde «Nuevo» en la barra lateral, en la carpeta que
  elijas (SSHorus recuerda la última). Usa la shell del sistema (`$SHELL`; PowerShell en Windows). Al
  cerrar la pestaña se termina lo que corre en ella **y sus procesos hijos**. El PIN también las tapa.
- **Claude Code y Codex con el contexto de SSHorus**: botones rápidos que los abren en una pestaña local.
  - Si no están instalados, SSHorus lo dice y ofrece instalarlos **mostrando antes el comando exacto**
    (el instalador oficial de Claude Code; `npm install -g @openai/codex` para Codex, avisando si falta
    Node.js). La instalación corre en la pestaña, a la vista.
  - Cada programa inicia sesión a su manera (suscripción o clave de API). SSHorus **no lee ni copia**
    `~/.claude` ni `~/.codex`.
  - El asistente recibe un **contexto**: tus servidores con su alias de `~/.ssh/config`, usuario, host,
    puerto, proyecto, si están conectados, qué servidor estabas mirando y la fecha. Sabe que puede usar
    `ssh <alias> '<comando>'` y qué servidores van con contraseña (para esos, el MCP). Nunca lleva
    contraseñas, llaves, tokens ni el PIN.
  - Y, si está activo, el **MCP de SSHorus** ya configurado (con tus permisos y aprobaciones). Si está
    apagado, SSHorus pregunta si activarlo o abrir solo con el contexto.
  - Nada se escribe en la carpeta del proyecto: a Claude Code se le pasa con `--append-system-prompt` y
    `--mcp-config`; a Codex con `-c developer_instructions=…` y `-c mcp_servers.sshorus.…`. El token del
    MCP va por una variable de entorno del proceso, no en archivos ni en los argumentos.
  - Ajustes → **Terminal local e IA**: vía (ssh directo, MCP o las dos), qué contexto se incluye, la
    carpeta de trabajo, ver el contexto exacto y si cada asistente está instalado.
- **Enviar a la IA**: en una terminal de servidor, selecciona texto y, con clic derecho, «Enviar a la IA».
  Se pega en la pestaña del asistente abierto (sin pulsar Enter, para que añadas tu pregunta) o abre uno.
- **Servidor nuevo: hosts guardados y prueba de conexión.** El campo Host sugiere tus servidores guardados
  (nombre y `usuario@host:puerto`) y avisa si ya tienes uno con el mismo host, puerto y usuario («Abrir»
  o, desde un proyecto, «Añadirlo»). Botón **«Probar conexión»**, y al guardar un servidor nuevo (o al
  cambiar sus datos de conexión) se prueba antes: conecta, comprueba la huella con el diálogo de siempre y
  desconecta, sin abrir pestaña, con 10 s de límite y «Cancelar prueba». Si falla dice por qué (host no
  encontrado, puerto cerrado, contraseña o llave rechazada…) y deja «Guardar de todos modos». La
  contraseña escrita solo se usa en memoria durante la prueba.

- **Asistentes de IA (MCP): «Aceptar automáticamente».** Por servidor (solo con acceso Completo), para no
  aprobar cada rato: **cambios normales** o **todo** (también lo peligroso y sudo, con advertencia en rojo y
  confirmación), durante 15 min, 1 h, hasta cerrar SSHorus o siempre. Se activa en Ajustes → Asistentes de
  IA o desde el propio diálogo de permiso. Con sudo usa la contraseña en memoria o guardada sin preguntar
  (la IA nunca la ve). Nunca con SSHorus bloqueado ni en solo lectura. Indicador «Automático» en la barra de
  pestañas (un clic lo apaga), etiqueta «automático» en la actividad y aviso en lo peligroso.

- **Ajustes con diseño nuevo y apariencias.** Menú lateral con iconos por grupos, buscador de ajustes,
  cabecera por sección y ajustes en tarjetas; se adapta a ventanas estrechas. Nueva sección **Apariencia**
  con 7 temas (Sistema, Oscuro, Claro, Medianoche, Arena, Fiordo y Alto contraste) que cambian también la
  terminal y el editor, al momento; color de acento elegible y tamaño de letra de la interfaz.
  Textos más cortos: una línea de ayuda como máximo y los detalles en tooltips.
- **Atajos de teclado configurables** (Ajustes → Atajos de teclado): 24 atajos (generales, terminal,
  explorador y guardar en el editor). Clic en un atajo y pulsa la combinación nueva; avisa si choca con
  otra acción o con teclas de la terminal (Ctrl+C, Ctrl+D…); restablecer uno o todos. Los menús y
  tooltips muestran el atajo actual.
- **Crear usuario con acceso solo por clave SSH** (Administración → Usuarios → «Nuevo usuario con
  clave…»): la clave se pega, se elige de `~/.ssh` o se genera (ed25519, en tu equipo; la privada nunca
  sale de él). Detecta AllowGroups/AllowUsers de sshd, ofrece sudo y linger, muestra los comandos antes,
  prueba el acceso con la clave y ofrece guardar el servidor. No toca PasswordAuthentication. También como
  comando de la Biblioteca (`usuarios.crear-usuario-clave`), usable por el asistente.
- **Auditar servidor** (Administración → Auditoría): un botón que revisa SSH, usuarios con sudo, puertos y
  cortafuegos, actualizaciones y reinicio pendiente, certificados, contenedores, servicios caídos, intentos
  de entrada, disco y memoria, y endurecimiento (`hidepid`, permisos de archivos sensibles…), sin instalar
  nada. Nota por categoría y general (A–F), comparación con la auditoría anterior, historial, exportar a
  Markdown o HTML y «Explicar con IA». Cada problema trae su comando para arreglarlo, que se muestra antes y
  se confirma (lo peligroso, escribiendo «ARREGLAR»). Para el asistente: `get_audit_report` y `run_audit`.
- **Mapa de infraestructura** (Administración → Mapa, o clic derecho en un proyecto → Mapa): diagrama de
  arquitectura que se arma solo: Internet → cortafuegos → puertos → proxy web → sitios (con su certificado)
  → contenedores y servicios → bases de datos, con una caja por usuario (con sudo, los de todos los
  usuarios). En un proyecto une los servidores y dibuja las conexiones entre ellos (p. ej. la app de un
  servidor → la base de datos de otro). Zoom, filtros, detalles al hacer clic y exportar a PNG, SVG o
  Mermaid. Para el asistente: `get_infra_map`.
- **Llaves SSH.** El formulario del servidor es más ancho y, al elegir «Llave SSH», muestra las llaves de
  `~/.ssh` para elegirlas. Nuevo asistente **«Crear llave SSH»** (explica qué es, la crea y te ayuda a ponerla
  en un servidor o en GitHub) y sección **Ajustes → Llaves SSH** para ver, copiar y usar tus llaves.
  Cada llave indica si es para **GitHub** o en qué servidores se usa (según `~/.ssh/config`, tus servidores y
  tu cuenta de GitHub), y el selector las agrupa. En el formulario, Host es más ancho y Usuario más estrecho.
- **Usuarios → «Añadir a SSHorus…»**: eliges con casillas qué usuarios del servidor guardar como servidores
  (ves si tienen llaves, contraseña o sudo, y si ya estaban). Con llave SSH (SSHorus puede instalar tu llave en
  su cuenta) o con contraseña, y prueba la conexión. Elige sola la llave que el usuario ya tiene autorizada
  (nunca una de GitHub) y nombra cada servidor como el usuario (editable). Por cada usuario eliges cómo entra:
  llave ya autorizada, **llave nueva creada e instalada** (por defecto si no tiene), una llave tuya o contraseña;
  al terminar prueba la conexión de cada uno.
- **Usuarios: «Solo llave»** cuando la contraseña está desactivada pero tiene llaves; «Bloqueada» solo si de
  verdad no puede entrar, con aviso si su sudo pide una contraseña que no tiene.
- **Terminal local: Antigravity (agy) y OpenCode**, además de Claude Code y Codex. OpenCode recibe el contexto
  de SSHorus y su MCP sin tocar tu configuración; agy recibe el contexto como primer mensaje (sin MCP).
- **Bloqueo con PIN o contraseña.** Puedes proteger SSHorus con un PIN de 6 números o con una contraseña
  (8 caracteres o más), y cambiar de uno a otro en Ajustes → Seguridad. La pantalla de bloqueo y los avisos
  piden lo que elegiste.
- **Explorador: clic derecho en una carpeta → «Añadir a proyecto»** (la guarda como marcador del proyecto).
- **Comandos con sudo sin escribir la contraseña en la terminal**: los de la biblioteca, «Terminar» procesos de
  otros usuarios e instalar Podman, Docker o tmux usan tu contraseña de sudo de SSHorus (mostrando antes el
  comando). Si SSHorus no sabe si tienes sudo, un botón comprueba si funciona sin contraseña.
- **Túneles: «Servicios que puedes traer».** Explicación sencilla y lista automática de lo que hay en el
  servidor (PostgreSQL, MySQL, Redis, MongoDB, paneles web, contenedores…), sobre todo lo que solo escucha por
  dentro. «Traer a mi PC» crea el túnel en un puerto libre con un clic, con la cadena de conexión para copiar y
  «Abrir en el navegador» para las webs.
  Se agrupan **por tipo** (base de datos, web, caché, colas, búsqueda, monitoreo, escritorio remoto) con color,
  icono y para qué sirve; los puertos desconocidos que responden como web se marcan como «Web».
- **Monitor por usuario**: explica qué muestra y resume CPU, memoria, procesos y contenedores de cada usuario,
  con filtro en la tabla; si el servidor oculta los procesos de otros (hidepid), con sudo se ven todos.
- **Panel de VPS**: el estado de todos tus servidores en tarjetas (en línea, CPU, memoria, disco, carga, servicios
  caídos, contenedores, actualizaciones y usuarios con sudo), agrupadas por proyecto o por IP, con avisos de color.
  Se abre en una **pestaña normal** (una para todos y una por proyecto) desde «Panel de VPS» en la barra lateral
  o con clic derecho en un proyecto. Lee por SSH sin instalar
  nada y solo mientras está abierto; si un servidor pide contraseña o código, espera a que pulses «Conectar».

### Cambiado
- **Mapa de infraestructura: zoom solo del mapa.** La rueda, el pellizco y Ctrl + / − / 0 hacen zoom del mapa
  (20 %–400 %, hacia el puntero), no de toda la app; botones − / % / + / «Ajustar» en la esquina y cajas más
  legibles en el tema claro.
- **El mapa se guarda**: al volver se ve al instante, con su zoom y selección y «Actualizado hace X»; se relee en
  segundo plano al reconectar o tras 10 min. En Linux, el **pellizco del touchpad** ya no agranda toda la app:
  sobre el mapa hace zoom del mapa.
- **Ctrl+W (⌘W) cierra el archivo abierto dentro del servidor**, no la conexión. Cerrar el servidor pasa a
  **Ctrl+Shift+W** (⇧⌘W) y pregunta si hay archivos sin guardar o transferencias sin terminar.
- **Atajos para moverse dentro del servidor**: sección siguiente/anterior (Alt+AvPág/RePág) y archivo abierto
  siguiente/anterior (Alt+Shift+AvPág/RePág), configurables en Ajustes → Atajos.
- Al transferir, si el archivo ya existe, ahora **se pregunta** qué hacer (antes se sobrescribía).
- Los archivos se abren **divididos** junto al explorador por defecto.

### Corregido
- **Mapa: cada cosa en la caja de su dueño real** (Sistema, cada usuario o «Sin identificar» cuando sin sudo no
  se puede saber). Ya nada del sistema aparece en la caja del usuario conectado.
  Selector **«Lo mío» / «Todo el servidor»**: sin sudo empieza en «Lo mío» (lo tuyo y, en gris, el camino desde
  Internet hasta ello); el resto queda plegado en «Otros», con una frase que explica qué puedes ver y qué no.
- **Formulario de servidor: avisos claros en sudo.** Si eliges «Guardar» sin escribir la contraseña, te
  avisa y se guarda como «Pedir cada vez». Si entras con llave SSH o agente, explica por qué no está «La de la
  conexión» y te sugiere «Guardar».
- **La contraseña de sudo guardada se pedía de nuevo**: tras un fallo pasajero (llavero, bóveda bloqueada,
  sudo lento), al cambiarla en el formulario o al desbloquear, SSHorus dejaba de usarla hasta reconectar.
- **sudo con contraseña en más sitios.** «Ejecutar en varios servidores» usa la contraseña de sudo de cada
  servidor (un diálogo a la vez, con «Saltar este servidor»). El escáner avisa si la contraseña guardada no
  funciona y deja escribir otra (un solo intento fallido por análisis). En el modo «La de la conexión» se usa
  también la contraseña escrita al conectar sin guardarla (solo en memoria; se borra al cerrar o bloquear).
- **Editor: la barra de estado se veía cortada** (el selector de lenguaje, p. ej. «Markdown», salía por
  la mitad en Linux por el aspecto nativo de GTK). Ahora tiene su propio estilo y la barra un poco más alta.
- **Asistentes de IA (MCP): los comandos con sudo funcionan.** `run_command` (p. ej. `sudo whoami`) y
  `run_catalog_command` (p. ej. «Crear usuario») fallaban con «sudo: a terminal is required to read the
  password». Ahora, tras aprobarlo en SSHorus, se usa la contraseña de sudo de esa conexión igual que en
  Administración: la que ya está en memoria, la guardada (o la de la conexión) o la de otra pestaña del
  mismo servidor; si no hay ninguna, se pide con el diálogo de siempre. Es la misma memoria que la de la
  interfaz: se pide como mucho una vez por conexión, también con varios `sudo` en un comando.
  - El asistente nunca la ve: va por la entrada estándar a un envoltorio que se la da a cada `sudo` (también
    en tuberías como `echo x | sudo tee /etc/y` o `sudo bash -c '…'`), sin dejarla en archivos, en la línea
    de comandos ni en el registro; si un comando la mostrara, se tapa en la respuesta.
  - Contraseña incorrecta: error claro en unos segundos («Contraseña de sudo incorrecta»), con un solo
    intento fallido; se olvida y la guardada queda marcada como rechazada, igual que en la interfaz.
  - Los comandos con sudo siguen pidiendo permiso siempre; con SSHorus bloqueado no se hace nada.
- **Añadir un servidor desde un proyecto**: cada proyecto de la barra lateral tiene ahora un botón **+**
  (y, con clic derecho, **Añadir servidor nuevo…** y **Añadir servidor existente**). El editor se abre
  indicando «Se añadirá al proyecto X», con un selector para cambiarlo o dejarlo sin proyecto. Al guardar,
  el servidor queda dentro del proyecto y aparece seleccionado en él. Antes se abría el editor normal y el
  servidor no quedaba en el proyecto.
- Los menús de la barra lateral con muchas entradas (p. ej. la lista de servidores) se desplazan en vez de
  salirse de la ventana.
- **sudo ya no pide otra vez una contraseña que está guardada.** Administración, Contenedores y el escáner
  buscan la contraseña siempre en el mismo orden antes de preguntar: la de esta conexión en memoria → la
  guardada del servidor (o la de la conexión) → la de otra pestaña abierta al mismo servidor → preguntar.
  - Si el diálogo se abría mientras la guardada aún se estaba comprobando (al entrar en el panel o al
    pulsar una acción enseguida), salía pidiéndola; ahora espera a esa comprobación y, si sirve, se cierra
    solo («Se usó la contraseña guardada de este servidor»).
  - Si la guardada no funciona, se pide **una vez** con el aviso «La contraseña guardada no funcionó» y
    «Guardar para este servidor» marcado, y al confirmarla se actualiza. Antes el diálogo volvía a
    aparecer cada vez que se entraba en la pestaña.
  - Tras desbloquear el PIN se vuelve a leer la guardada si la lectura había fallado por estar bloqueado.
  - «Guardar para este servidor» viene marcado si el servidor ya usa una contraseña guardada o la de la
    conexión.
  - Una segunda pestaña al mismo servidor reutiliza la contraseña ya escrita en la primera (comprobada con
    sudo antes de usarla). «Olvidar contraseña de sudo» lo sigue respetando hasta reconectar.

- **Contenedores con sudo ya ven los de todos los usuarios.** Con root o sudo aparece el selector
  **Usuario**: tú, **root** y cada usuario con contenedores propios (Podman rootless; también Docker
  rootless si su demonio está en marcha), o **Todos**. La lista de usuarios es la misma que usa el escáner.
  - Con **Todos**, las listas (contenedores, imágenes, volúmenes, redes y proyectos Compose) llevan la
    columna **Usuario**. Se leen todos a la vez en un solo script; si un usuario falla, se ve su error y
    los demás aparecen igual.
  - **Cada acción se ejecuta como el dueño** (iniciar, parar, logs, terminal dentro, inspeccionar,
    borrar, descargar imagen, volúmenes, redes, Compose, nuevo contenedor y limpieza): se entra como él
    con `runuser` (o `sudo -u`, o `su`) con su HOME y su `XDG_RUNTIME_DIR`, nunca como root. El comando
    que se muestra y el que va a la terminal lo dicen («sudo runuser -u ana -- …»).
  - Con **Todos**, crear y limpiar piden elegir antes un usuario arriba.
  - Sin sudo todo sigue como antes: solo lo de tu usuario.

## [0.5.0] - 2026-11-12

### Añadido
- **Asistentes de IA (MCP)**: servidor MCP propio para que Claude Code, Claude Desktop
  u otro cliente MCP trabajen con tus servidores **usando las conexiones de TerView, sin ver nunca
  contraseñas ni llaves**. Apagado por defecto; se activa en Ajustes → Asistentes de IA (MCP).
  - Permiso por servidor: **Sin acceso** (por defecto), **Solo lectura** o **Completo**. Las lecturas
    pasan solas; todo lo que cambia algo abre un diálogo en TerView con el comando exacto (o las
    diferencias del archivo): Permitir una vez / Permitir siempre este comando en este servidor /
    Denegar. Si nadie responde en 2 minutos (ajustable), se deniega. Lo peligroso (`rm -rf`, `prune`,
    `sudo`, `reboot`… o un comando ⚠️ de la Biblioteca) se pregunta siempre.
  - Con TerView bloqueado por PIN, el asistente no puede hacer nada.
  - Herramientas: servidores, proyectos y conexiones, abrir una conexión (como pestaña), ejecutar
    comandos (cancelables, con tiempo y salida limitados), comandos de la Biblioteca, explorar, leer y
    escribir archivos, subir y descargar con la cola de transferencias, ver puertos, sitios web y
    contenedores, y consultar vulnerabilidades (el último informe, o un análisis nuevo sin sudo que se
    aprueba la primera vez).
  - Escucha solo en `127.0.0.1` con un token que se puede regenerar (guardado como tus contraseñas). Para
    clientes por stdio se instala el puente `terview-mcp`. Cada acción queda en el panel **Actividad del
    asistente** (con botón para detener un comando) y en `mcp-audit.jsonl`. Ajustes muestra la
    configuración lista para copiar en Claude Code y Claude Desktop.
- **Escáner de vulnerabilidades** (Administración → **Vulnerabilidades**): un botón **Analizar** que dice
  qué software tiene el servidor (paquetes, kernel, sudo, OpenSSH, nginx, Caddy, Podman, Docker, Node,
  Python, PHP, Java e imágenes de contenedores) y qué vulnerabilidades conocidas le afectan.
  - La lista sale de bases de datos reales: **OSV.dev** (consultado desde tu PC, solo con nombres y
    versiones de paquetes), la herramienta de seguridad de la distro (`dnf`, `debsecan`, `pro`,
    `zypper`) y **Trivy** si el servidor lo tiene. Nunca de una IA.
  - Resumen por gravedad, cambios desde el análisis anterior, tabla con filtros, detalle con enlaces y el
    **comando para actualizar** (se copia o se escribe en la terminal sin Enter; nunca se ejecuta solo).
  - Con sudo, también los contenedores de root y de los usuarios que elijas. Las imágenes se leen sin
    arrancarlas. **Cancelar** detiene el análisis también en el servidor.
  - Historial de los últimos 20 análisis por servidor; exportar a JSON y Markdown.
  - Atajo desde Contenedores → Imágenes: «Ver vulnerabilidades».
- **Contenedores (Podman / Docker)**: pestaña visual para iniciar, parar, reiniciar y eliminar
  contenedores, ver logs, abrir una terminal dentro, crear contenedores con plantillas (Nginx,
  PostgreSQL, MySQL, MariaDB, Redis, Adminer, Portainer), levantar y bajar proyectos **Compose**, y
  limpiar imágenes, volúmenes y redes que no se usan mostrando antes cuánto espacio se libera.
- **Administración del servidor**: una pestaña con varias secciones. Antes de cada cambio se muestra
  el comando exacto, y la contraseña de sudo viaja siempre por la entrada estándar.
  - **Usuarios y grupos**: crear, editar, bloquear y eliminar usuarios, sus llaves SSH, grupos,
    sesiones conectadas e historial de cambios.
  - **Puertos**: todos los puertos en escucha, TCP y UDP, con su proceso, usuario y servicio systemd
    o contenedor. Filtros (públicos o solo locales, usuario, proceso), abrir un túnel a tu PC con un
    clic y copiar la dirección.
  - **Sitios web**: sitios de **nginx** y **Caddy** con sus dominios, HTTPS y fecha de caducidad del
    certificado, a qué sirve cada ruta y si hay algo escuchando en el puerto de destino. Abre la
    configuración en el editor, la comprueba y recarga el servicio con confirmación.
- **Monitor**: gráficas en vivo de CPU, memoria, red y carga, discos, procesos (con botón Terminar),
  consumo de contenedores, alertas configurables y resumen de todas las conexiones.
- **Túneles (port forwarding)**: local, remoto y SOCKS, guardados por servidor, con arranque
  automático al conectar y continuidad tras reconexiones.
- **Ejecutar en varios servidores a la vez**: un comando (o uno de la biblioteca) en varios servidores
  o en un proyecto entero, con resultados en tabla, lado a lado y «Comparar salidas».
- **GitHub**: conectar la cuenta con un token (guardado de forma segura), pasar tus llaves SSH a un
  servidor, clonar repositorios (con deploy key), desplegar con un botón, ver y lanzar GitHub Actions,
  y sincronizar tu configuración en un Gist cifrado.
- **Terminales persistentes (tmux)**: si el servidor tiene tmux, cada terminal vive en su propia sesión
  y sigue corriendo aunque se corte la red o cierres la app; al reconectar, TerView vuelve a ella.
  Ajuste Automático / Siempre / Nunca (general y por servidor), indicador ∞ en la pestaña, lista de
  sesiones que quedaron en el servidor para reabrirlas o cerrarlas, y «Desacoplar» para dejar una
  corriendo. El historial, la búsqueda y el copiar/pegar funcionan igual que sin tmux, y no se toca tu
  `~/.tmux.conf`.
- **PIN y bloqueo**: las contraseñas guardadas (de conexión y de sudo) y los tokens (GitHub, IA y MCP)
  pueden ir en una bóveda cifrada (`vault.json`, AES-256-GCM + Argon2id) protegida con un **PIN de 6
  números** y una llave de este equipo guardada en el llavero, así que copiar solo el archivo no sirve.
  - Al crearla, lo que había en el llavero se mueve a ella sin riesgo de perderlo; al quitarla, vuelve
    al llavero.
  - TerView se bloquea al abrirlo, tras 5–60 min sin uso (15 por defecto) o con `Ctrl+Shift+L`, en
    todas las ventanas: se tapa la interfaz y se borran de la memoria las contraseñas descifradas y las
    de sudo hasta que escribes el PIN. Las conexiones siguen vivas; una reconexión que necesita
    contraseña espera al desbloqueo.
  - Tras 5 fallos hay que esperar 30 s, el doble cada vez hasta 15 min (se recuerda aunque cierres la
    app).
  - El PIN se escribe en 6 casillas y se envía solo al completarlo. Las bóvedas creadas antes con una
    contraseña libre se siguen abriendo con un campo de texto hasta que cambias el PIN.
  - **«Olvidé mi PIN»** borra la bóveda (escribiendo BORRAR): se pierden las contraseñas y los tokens, y
    se conservan servidores, llaves, comandos, túneles y ajustes.
  - Pantalla para crearlo la primera vez, con «Ahora no», y **candado en la barra de pestañas** para
    bloquear, cambiar el PIN o ir a Ajustes → Seguridad. Los detalles están en «¿Qué protege?».
- **Contraseña de sudo por servidor** (editor de servidor): «Pedir cada vez» (por defecto, solo en
  memoria), «La de la conexión» o «Guardar» (útil si entras con llave SSH), cifrada con el PIN o en el
  llavero. Botón de ojo para ver la contraseña guardada (con PIN, lo pide antes). En Administración,
  «Cambiar contraseña de sudo…»; si la guardada falla, se pide otra y se ofrece guardarla. Borrar,
  duplicar y activar o quitar el PIN la tienen en cuenta; la copia en Gist solo lleva el modo.
- **Detección de privilegios**: insignia **root** / **sudo** en la pestaña de la conexión, sin pedir
  contraseña ni dejar rastro en el servidor.
- **IA opcional para explicar informes** (Ajustes → IA para explicar informes): cualquier servicio
  compatible con OpenAI (también uno local como Ollama). Es otra cosa que el MCP: aquí TerView le
  pregunta a la IA, y solo para que **explique** un informe. Antes de enviar ves el texto exacto, sin
  nombre del servidor, IP, usuarios ni rutas. El token va en la bóveda o el llavero.
- **Manual de uso dentro de la app** (Ajustes → Manual de uso, el botón ? de la barra o la bienvenida):
  pasos cortos con capturas de cada función, atajos de teclado y solución de problemas.
- **Novedades y actualizaciones automáticas**: tras actualizar, TerView muestra una vez lo nuevo de la
  versión; el historial completo está en Acerca de. Las actualizaciones van firmadas.
- Explorador: **arrastrar archivos y carpetas al escritorio o a una carpeta** del gestor de archivos
  (Nautilus, Dolphin, Explorador de Windows, Finder). TerView primero los descarga a una carpeta
  temporal (se ve en Transferencias) y luego los suelta donde quieras; si ya estaban descargados, el
  arrastre es inmediato. Funciona con nombres con espacios y acentos, en X11 y en Wayland.
  ⚠️ Sin probar todavía con un arrastre real; en macOS, además, sin compilar.
- Explorador: **«Descargar en…»** y **«Descargar y abrir carpeta»**.
- Transferencias: opción **«Preguntar»** cuando el archivo ya existe (sobrescribir, omitir, mantener
  ambos o solo si es más nuevo, con «aplicar a todos»).
- **Editor en pestañas, como un navegador**: arrastra una pestaña fuera para abrirla en otra ventana,
  reordénalas arrastrando y divide con el explorador solo si quieres (`Ctrl+Shift+M`).
- «Mis comandos»: **exportar e importar a archivo**, con vista previa.
- `~/.ssh/config`: aviso cuando un servidor choca con un `Host` escrito a mano, con un alias
  alternativo.
- **Diagnóstico** (Ajustes → Avanzado): tiempos de arranque y de cada operación, FPS, GPU y «Copiar
  informe».

### Mejorado
- **Cancelar ahora detiene el comando en el servidor**: en el panel de Comandos y en «Ejecutar en
  varios servidores» (también en las pestañas ya abiertas). Antes solo se dejaba de esperar y el
  comando seguía corriendo. Al vencer el tiempo límite también se detiene.
- **Túneles a puertos bajos** (menores de 1024, como 80 o 443): «Abrir túnel» elige solo un puerto
  libre en tu PC, porque esos puertos piden permisos de administrador. Sirve en Puertos y en
  Contenedores.
- **Ajustes** en una ventana un poco más ancha (se adapta a pantallas pequeñas).

### Corregido
- **Doble clic en un servidor** de la barra lateral: ahora va a su pestaña abierta (y la reconecta si
  hace falta) en lugar de abrir otra conexión. Para abrir otra conexión: Ctrl+doble clic.

## [0.3.0] - 2026-11-11

### Añadido
- **Soporte para Windows 10 / 11**: instaladores `-setup.exe` (NSIS, en español, instalación por
  usuario sin permisos de administrador) y `.msi` (WiX, para empresas o instalación silenciosa).
  Si falta Microsoft Edge WebView2, el instalador lo descarga solo.
- **Instaladores automáticos con GitHub Actions**: al publicar una versión se generan los
  instaladores de Linux (`.rpm`, `.deb`, `.AppImage`), Windows (`.msi`, `-setup.exe`) y macOS
  (`.dmg` universal) y se adjuntan al Release.
- **Integración continua**: en cada cambio se comprueba que la app compila y pasa las pruebas en
  Linux y en Windows.

- **Agente SSH en Windows**: usa el agente de OpenSSH de Windows o Pageant.
- Ajuste **"Aceleración por GPU en la terminal"** (WebGL), activado por defecto, con vuelta automática
  al dibujado normal si la GPU falla.

### Mejorado
- **Arranque más rápido**: el código inicial pasa de 914 KB a 362 KB; el resto (sesiones, comandos,
  ajustes, editor) se carga cuando hace falta o en segundo plano.
- **Ventana más fluida en Linux con NVIDIA**: se detecta el driver y se aplica el arreglo de dibujado
  de WebKitGTK automáticamente (`TERVIEW_WEBKIT_DEFAULTS=1` lo desactiva).
- Menos redibujados de la interfaz durante transferencias y reconexiones; estilos más ligeros.
- Descargas en Windows: los nombres no válidos (`: * ? " < > |`, `CON`, `NUL`…) se adaptan solos
  y los nombres repetidos se guardan como `nombre (2).ext`.
- Guardado de ajustes y huellas más robusto en Windows (reintenta si otro programa tiene el archivo abierto).
- Rutas de Windows (`C:\...`) en arrastrar y soltar, `~/.ssh/config` y llaves.

### Notas
- Los instaladores de Windows y macOS aún no están firmados: Windows SmartScreen puede mostrar
  "Windows protegió su PC" (*Más información → Ejecutar de todas formas*).

## [0.2.1] - 2026-11-11

### Documentación
- README completo: funciones, instalación paso a paso por sistema (Fedora/RHEL/openSUSE,
  Debian/Ubuntu, AppImage, Windows y macOS), primeros pasos, atajos de teclado, solución de
  problemas y desarrollo.

## [0.2.0] - 2026-11-11

Primera versión pública de TerView, cliente SSH/SFTP de escritorio.

### Añadido
- **Conexiones SSH** con contraseña, llave o agente SSH; verificación de la huella del servidor y
  **doble factor (2FA / códigos OTP)**.
- **Reconexión rápida y automática** cuando se corta la red.
- **Terminal integrada** (xterm.js) con búsqueda (`Ctrl+Shift+F`) y atajos documentados.
- **Explorador de archivos remoto** con **editor** integrado (Monaco).
- **Transferencias masivas** de archivos y carpetas: cola con límite de transferencias simultáneas
  por servidor, enlaces simbólicos y política ante conflictos (sobrescribir / omitir / solo si es
  más nuevo).
- **Biblioteca de comandos** (Podman, Docker, análisis del sistema, discos, red, servicios, logs…),
  paleta rápida `Ctrl+Shift+P`, comandos con variables, "Analizar servidor" y "Mis comandos".
- **Servidores y proyectos guardados**, duplicar servidor; contraseñas en el **llavero del
  sistema**.
- **Exportar e importar `~/.ssh/config`**.
- Logo e ícono de la aplicación.
- Instalador `.rpm` para Linux.
- Documentación con diagramas en `docs/`.

[1.0.0-beta.3]: https://github.com/LeoMael/SSHorus/releases/tag/v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/LeoMael/SSHorus/releases/tag/v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/LeoMael/SSHorus/releases/tag/v1.0.0-beta.1
[0.5.0]: https://github.com/LeoMael/SSHorus/releases/tag/v0.5.0
[0.3.0]: https://github.com/LeoMael/SSHorus/releases/tag/v0.3.0
[0.2.1]: https://github.com/LeoMael/SSHorus/releases/tag/v0.2.1
[0.2.0]: https://github.com/LeoMael/SSHorus/commit/6dfd50a
