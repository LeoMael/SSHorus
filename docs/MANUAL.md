# Manual de uso de SSHorus

SSHorus es un programa para trabajar con tus servidores Linux desde tu PC: terminal, archivos, comandos, contenedores y más, todo en una sola ventana.

Este manual también está dentro de SSHorus: pulsa el botón **?** de la barra de pestañas, o ve a **Ajustes → Manual de uso**.

## Índice

1. [Instalar y actualizar](#instalar-y-actualizar)
2. [Añadir un servidor](#añadir-un-servidor)
3. [Proyectos y favoritos](#proyectos-y-favoritos)
4. [Terminal](#terminal)
5. [Explorador de archivos](#explorador-de-archivos)
6. [Transferencias](#transferencias)
    - [Sincronizar carpeta](#sincronizar-carpeta)
7. [Editor](#editor)
    - [Comparar archivos](#comparar-archivos)
8. [Comandos](#comandos)
9. [Ejecutar en varios servidores](#ejecutar-en-varios-servidores)
10. [Contenedores](#contenedores)
11. [Bases de datos](#bases-de-datos)
12. [Monitor y alertas](#monitor-y-alertas)
13. [Túneles](#túneles)
14. [Administración](#administración)
15. [Vulnerabilidades](#vulnerabilidades)
    - [Auditar servidor](#auditar-servidor)
    - [Auditar proyecto](#auditar-proyecto)
    - [Auditoría programada](#auditoría-programada)
    - [Configuración y seguridad del servidor](#configuración-y-seguridad-del-servidor)
16. [IA para explicar informes](#ia-para-explicar-informes)
17. [GitHub](#github)
18. [PIN y bloqueo](#pin-y-bloqueo)
19. [Asistentes de IA (MCP)](#asistentes-de-ia-mcp)
    - [Desplegar con la IA](#desplegar-con-la-ia)
20. [Terminal local y asistentes de IA](#terminal-local-y-asistentes-de-ia)
    - [Claude Code en un servidor con tu cuenta](#claude-code-en-un-servidor-con-tu-cuenta)
21. [Ajustes](#ajustes)
22. [Atajos de teclado](#atajos-de-teclado)
23. [Tareas en segundo plano](#tareas-en-segundo-plano)
24. [Historial por servidor](#historial-por-servidor)
25. [Solución de problemas](#solución-de-problemas)

---

## Instalar y actualizar

![Ventana Acerca de con la versión y el botón «Buscar actualizaciones»](manual/01-instalar.png)

**Para qué sirve:** tener SSHorus en tu PC y al día.

**Cómo se usa:**

1. Abre la página de [la última versión](https://github.com/LeoMael/SSHorus/releases/latest) y baja el archivo de tu sistema.
2. Windows: ejecuta el `…-setup.exe`. Fedora: `sudo dnf install ./SSHorus-*.rpm`. Ubuntu: `sudo apt install ./SSHorus_*.deb`. Cualquier Linux: la `.AppImage` (dale permiso con `chmod +x`).
3. Para actualizar, ve a **Ajustes → Acerca de** y pulsa **Buscar actualizaciones**.
4. Si hay una versión nueva, pulsa **Actualizar y reiniciar**.

**Notas:**

- Con **Buscar actualizaciones automáticamente** activado, SSHorus mira al abrirse y te avisa con **Ver novedades** o **Más tarde**.
- Con `.deb` o `.rpm` te pedirá tu contraseña de administrador al instalar.
- Si sale «Esta instalación no se actualiza sola», pulsa **Ir a descargas** y baja el instalador nuevo.
- Si venías de **TerView** (el nombre anterior), SSHorus empieza vacía: añade otra vez tus servidores o usa **Importar `~/.ssh/config`**, y vuelve a escribir las contraseñas. <!-- sin-renombrar -->

## Añadir un servidor

![Diálogo «Editar servidor» con autenticación, contraseña de sudo y tmux](manual/02-servidor.png)

**Para qué sirve:** guardar los datos de un servidor para entrar con un doble clic.

**Cómo se usa:**

1. En la barra lateral pulsa **+ Nuevo → Servidor**.
2. Escribe **Nombre**, **Host**, **Puerto** y **Usuario**. Al escribir el host verás tus servidores guardados; elige uno para copiar su host y puerto.
3. En **Autenticación** elige **Contraseña**, **Llave SSH** o **Agente SSH**.
4. En **Contraseña de sudo** elige **Pedir cada vez**, **La de la conexión** o **Guardar**. Con **La de la conexión** vale también la contraseña que escribes al conectar aunque no la guardes: SSHorus la recuerda mientras dure la conexión y la olvida al cerrarla o al bloquear.
5. Pulsa **Guardar**. Antes de guardar, SSHorus prueba la conexión (máx. 10 s) y desconecta.
6. La primera vez verás la huella del servidor: si es el tuyo, pulsa **Confiar y conectar**.
7. Haz **doble clic** en el servidor para conectarte.

**Notas:**

- **Llave SSH**: elige la llave **privada** (sin `.pub`). Si tiene frase, escríbela y marca **Guardar la frase**.
- **2FA**: si el servidor pide un código, sale la ventana **Código de verificación**. Escribe el código de tu app y pulsa **Verificar**.
- **Probar conexión**: pruébala cuando quieras sin guardar. Si falla, verás el motivo (no se encuentra el host, puerto cerrado, contraseña o llave rechazada, huella cambiada) y puedes pulsar **Guardar de todos modos** (por ejemplo, si el servidor está apagado ahora). Al editar solo se prueba si cambias host, puerto, usuario o autenticación.
- **Servidor repetido**: si ya tienes uno con el mismo host, puerto y usuario, verás «Ya tienes este servidor guardado como «X»» con **Abrir** para ir a ese.
- **Terminales persistentes (tmux)**: **Automático**, **Siempre** o **Nunca**. Lo normal es dejar «Como en Ajustes».
- Para entrar rápido sin guardar nada, escribe `usuario@host:puerto` en **Conexión rápida** y pulsa `Enter`.

## Proyectos y favoritos

![Barra lateral con proyectos, servidores y carpetas favoritas](manual/03-proyectos.png)

**Para qué sirve:** agrupar servidores (por cliente, por entorno…) y guardar carpetas a las que vas a menudo.

**Cómo se usa:**

1. Pulsa **+ Nuevo → Proyecto**, escribe un **Nombre** y marca sus **Servidores**.
2. En **Marcadores (carpetas favoritas)** añade un servidor y una ruta, por ejemplo `/var/www/app`.
3. Pulsa un marcador en la barra lateral para abrir el servidor directamente en esa carpeta.
4. Con clic derecho en un servidor tienes **Añadir a proyecto** y **Añadir marcador…**.
5. Para meter un servidor en un proyecto, pulsa el **+** de su fila (o clic derecho en el proyecto):
   **Añadir servidor nuevo…** abre el editor ya dentro del proyecto; **Añadir servidor existente** muestra
   los servidores guardados que aún no están en él.
6. Con clic derecho en un proyecto tienes también **Conectar a todos** y **Ejecutar comando en el proyecto…**.

**Importar o exportar `~/.ssh/config`:**

1. Pulsa **+ Nuevo → Importar de ~/.ssh/config…**.
2. Marca los servidores que quieras y pulsa **Importar**.
3. Para el camino contrario, pulsa **+ Nuevo → Exportar a ~/.ssh/config**.

**Notas:**

- En Windows el archivo es `%USERPROFILE%\.ssh\config`.
- En **Ajustes → Servidores** puedes activar **Mantener ~/.ssh/config sincronizado**. Así tus servidores también funcionan con `ssh`, VS Code o Claude Code.

**Varias cuentas del mismo servidor:**

- Si guardas varios usuarios del mismo servidor (mismo host y puerto), la barra lateral los junta bajo una fila con
  el host y cuántas cuentas hay. Pulsa la fila (o `→` / `←`) para desplegarla o plegarla; se recuerda.
- La cuenta con **sudo** sale primero y lleva una **S** (también si entras como root). SSHorus lo sabe al
  conectarte y lo recuerda para la próxima vez. Si nunca te conectaste, se fía de la **Contraseña de sudo** del
  servidor (**Guardar** o **La de la conexión**). Sin datos, no hay marca.
- Clic derecho en la fila del servidor: **Conectar todas las cuentas**, **Ejecutar comando en estas cuentas…** y
  **Renombrar máquina…** para ponerle un nombre propio (p. ej. «VPS de la tesis») en vez del host. Déjalo vacío para
  volver al host. El buscador también lo encuentra por ese nombre.

## Terminal

![Terminal con dos pestañas, una persistente con el símbolo ∞](manual/04-terminal.png)

**Para qué sirve:** escribir comandos en el servidor, como en `ssh`.

**Cómo se usa:**

1. Conéctate: la terminal aparece abajo.
2. Pulsa **+** (**Nueva terminal**) para abrir otra.
3. Para copiar y pegar usa `Ctrl+Shift+C` y `Ctrl+Shift+V`, o el clic derecho.
4. Para buscar texto pulsa `Ctrl+Shift+F`. `Enter` va al siguiente y `Shift+Enter` al anterior.
5. Para ocultar o mostrar la terminal pulsa `` Ctrl+` ``.

**Terminales persistentes (tmux):**

- Si el servidor tiene tmux, cada terminal sigue viva aunque se corte la red o cierres SSHorus. Lo verás con el símbolo **∞** en su pestaña.
- Al volver a conectar, SSHorus retoma la terminal sola.
- Clic derecho en la pestaña → **Desacoplar (sigue corriendo en el servidor)** para dejarla trabajando.

**Sesiones sueltas:**

1. Si quedaron terminales en el servidor, el botón **Terminales persistentes en el servidor** muestra un número.
2. Púlsalo y elige **Abrir** para retomar una, o **Cerrar** para terminarla.

**Notas:**

- Con el foco en la terminal, `Ctrl+W` y `Ctrl+B` son de la shell (borrar palabra, prefijo de tmux), no de SSHorus.
- Cerrar una terminal persistente termina su sesión tmux.

## Explorador de archivos

![Explorador con la lista de archivos y el menú del clic derecho](manual/05-archivos.png)

**Para qué sirve:** ver y manejar los archivos del servidor como en el explorador de tu PC.

**Cómo se usa:**

1. Abre la pestaña **Archivos**. Doble clic en una carpeta para entrar.
2. Para subir, pulsa **Subir** o **Subir carpeta**, o arrastra archivos desde tu PC a la lista.
3. Para bajar, selecciona y pulsa **Descargar**, o clic derecho → **Descargar en…** y elige la carpeta.
4. Clic derecho → **Descargar y abrir carpeta** baja a Descargas y luego abre la carpeta.
5. Para llevarlo al escritorio, arrastra el archivo fuera de SSHorus y suéltalo donde quieras.
6. Clic derecho → **Permisos…** para marcar lectura, escritura y ejecución (o escribir el número **Octal**).

**Notas:**

- También tienes **Nueva carpeta**, **Nuevo archivo**, **Renombrar**, **Copiar ruta** y **Eliminar**.
- El botón del ojo muestra u oculta los archivos ocultos (los que empiezan por punto).
- Al arrastrar al escritorio, SSHorus primero lo baja a una carpeta temporal. Lo verás en Transferencias.

## Transferencias

![Panel de transferencias con una subida en curso](manual/06-transferencias.png)

**Para qué sirve:** ver cómo van las subidas y bajadas, y controlarlas.

**Cómo se usa:**

1. Sube o baja algo. Abajo aparece la barra de transferencias.
2. Púlsala (**Ver transferencias**) para ver la lista completa.
3. Usa **Pausar**, **Reanudar** o **Cancelar** en cada una.
4. Si algo falla, pulsa **Reintentar los fallidos**.
5. Pulsa **Limpiar terminados** para vaciar la lista.

**Notas:**

- Si se corta la red, la transferencia sigue desde donde quedó al volver la conexión.
- Si el archivo ya existe, se hace lo que digas en **Ajustes → Transferencias → Si el archivo ya existe**.
- Con **Preguntar**, verás **Sobrescribir**, **Omitir**, **Mantener ambos** o **Solo si es más nuevo**, y la casilla **Aplicar a todos los conflictos de esta transferencia**.

### Sincronizar carpeta

**Para qué sirve:** eliges una carpeta de tu PC y otra del servidor y quedan unidas: cada vez que guardas un
archivo en tu PC, se sube solo al servidor. Ideal para una web: editas en tu PC y el servidor ya lo tiene.

**Cómo se usa:**

1. En **Archivos**, clic derecho en una carpeta (o en el vacío de la carpeta abierta) → **Sincronizar con una
   carpeta de mi PC…**.
2. Pulsa **Elegir…** y escoge la carpeta de tu PC.
3. Si quieres, escribe en **No subir** lo que no debe subirse (uno por línea, como en `.gitignore`: `*.log`,
   `dist/`, `/config.local.php`).
4. Pulsa **Comparar**. Verás cuántos archivos faltan o son más nuevos en tu PC (y cuánto ocupan), cuántos ya
   están iguales y cuáles son **más nuevos en el servidor**: esos no se tocan, salvo que marques **Subir también
   estos**.
5. Pulsa **Unir y subir** (o **Unir sin subir nada** si solo quieres lo que guardes a partir de ahora).

Encima de la barra de transferencias verás cada carpeta unida con su estado (**Al día**, **Subiendo 3**,
**Error: …**) y el último archivo subido, con **Pausar** y **Dejar de sincronizar**. Las subidas también salen en
la lista de transferencias.

**Notas:**

- Va en un solo sentido: de tu PC al servidor. Lo que cambie en el servidor no baja a tu PC.
- Nunca se suben `.git`, `node_modules` ni los temporales de los editores (`*.swp`, `*~`, `.#*`). Puedes añadir
  más en un archivo `.sshorusignore` dentro de la carpeta de tu PC.
- Borrar en tu PC **no** borra en el servidor, salvo que marques **Borrar también en el servidor** (pide
  confirmación). Aun así, si borras más de 50 archivos de golpe, no se borran allí y te avisa.
- Funciona mientras la conexión esté abierta. Si se corta, los cambios esperan y se suben al volver.
- Con un servidor guardado, marca **Recordarla en este servidor**: al conectar otra vez te ofrecerá
  **Reactivar** (con la misma comparación antes de subir nada).
- Se vigilan hasta 20 000 archivos; si la carpeta es más grande, te avisa para que ignores carpetas.

## Editor

![Editor con dos archivos abiertos en pestañas](manual/07-editor.png)

**Para qué sirve:** editar archivos del servidor sin bajarlos, con el mismo editor de VS Code.

**Cómo se usa:**

1. En **Archivos**, haz doble clic en un archivo de texto. Se abre en una pestaña.
2. Edita y pulsa `Ctrl+S` (o el botón **Guardar**) para guardarlo en el servidor.
3. Arrastra una pestaña para cambiarla de orden.
4. Para abrirla en una ventana aparte, arrástrala fuera de la ventana o usa clic derecho → **Abrir en ventana aparte**.
5. En esa ventana, **Volver a la pestaña principal** la devuelve como pestaña.

**Notas:**

- Clic derecho en la pestaña: **Dividir con Archivos** o **Dividir con Comandos**. `Ctrl+Shift+M` divide o quita la división.
- Clic central en una pestaña la cierra; `Ctrl+W` cierra el archivo que estás viendo.
- `Alt+Shift+AvPág` / `Alt+Shift+RePág` pasan al archivo abierto siguiente o anterior.
- En **Ajustes → Editor → Al abrir un archivo** eliges **Pestaña**, **Dividido** o **En ventana aparte**.

### Comparar archivos

**Para qué sirve:** ver qué cambia entre dos archivos, lado a lado: lo añadido en verde y lo quitado en rojo.

**Cómo se usa:**

1. En **Archivos**, clic derecho en un archivo → **Comparar con…** y elige con qué:
   - **Un archivo de mi PC…**
   - **El mismo archivo en «otro servidor»…** (el otro servidor tiene que estar conectado en otra pestaña;
     la ruta es la misma, pero puedes cambiarla).
   - **Otro archivo de este servidor…** (escribe su ruta).
   - Una **copia de seguridad** que ya esté en la carpeta (por ejemplo, la que hace **Editar compose**).
2. O selecciona dos archivos → clic derecho → **Comparar los dos**.
3. Se abre en una pestaña nueva. La izquierda es solo para mirar; la derecha (el archivo del servidor) se puede
   editar y guardar con `Ctrl+S`, con los mismos avisos que el editor.

**Notas:**

- Abajo: **Lado a lado** o **En línea**, **Ignorar espacios** y las flechas para ir a la diferencia anterior o
  siguiente (también `F7` y `Mayús+F7`).
- El botón de las dos flechas, arriba, **intercambia los lados** (así puedes editar el otro).
- Los archivos binarios o de más de 5 MB no se comparan: sale un aviso. Si un archivo no existe, se ve vacío.

## Comandos

![Pestaña Comandos con categorías, un comando y su resultado](manual/08-comandos.png)

**Para qué sirve:** usar comandos listos (Podman, Docker, discos, red, logs…) sin tener que recordarlos.

**Cómo se usa:**

1. Abre la pestaña **Comandos** y elige una categoría, o escribe en **Buscar comando…**.
2. Pulsa un comando. Si tiene variables (por ejemplo el nombre de un contenedor), rellénalas.
3. Pulsa **Ejecutar** (en la terminal), **Insertar en terminal** (sin pulsar Enter) o **Ejecutar y ver resultado** (la salida sale aquí mismo).
4. Si tarda demasiado, pulsa **Cancelar**: se detiene también en el servidor.
5. Pulsa **Analizar servidor** para un informe rápido: sistema, CPU, memoria, discos, procesos, puertos, contenedores y errores.

![Informe de «Analizar servidor» con sistema, CPU, memoria y discos](manual/08b-analizar.png)

**Mis comandos:**

1. Pulsa **Nuevo comando**, escribe **Nombre** y **Comando**, y elige dónde está **Disponible en**.
2. Para variables escribe `{{nombre}}`, o con valor por defecto `{{lineas:200}}`.
3. En **★ Mis comandos** tienes **Exportar a archivo…** e **Importar desde archivo…** para pasarlos a otro PC.

**Notas:**

- `Ctrl+Shift+P` abre la paleta rápida de comandos desde cualquier sitio.
- Un comando de la biblioteca no se puede cambiar, pero sí **Copiar a Mis comandos…** y editar la copia.

## Ejecutar en varios servidores

![Panel «Ejecutar en varios servidores» con la tabla de resultados](manual/09-varios-servidores.png)

**Para qué sirve:** lanzar el mismo comando en muchos servidores a la vez y comparar lo que responde cada uno.

**Cómo se usa:**

1. Pulsa el botón **Ejecutar en varios servidores** de la barra lateral (o clic derecho en un proyecto).
2. Marca los servidores, o un proyecto entero.
3. Escribe el comando o pulsa **Biblioteca…** para elegir uno.
4. Pulsa **Ejecutar en N servidores**.
5. Mira el resultado en **Tabla**, **Lado a lado** o **Comparar salidas**.

**Notas:**

- No hace falta tenerlos abiertos: se conectan en segundo plano y se desconectan al terminar.
- **Cancelar todo** detiene el comando en todos. **Repetir** lo vuelve a lanzar.
- Los comandos con `sudo` funcionan igual que en Administración: SSHorus usa la contraseña de sudo que ya tiene (en memoria, guardada u otra pestaña). Si falta, te la pide **de un servidor en uno**; pulsa **Saltar este servidor** para no ejecutarlo ahí.
- Como root o con sudo sin contraseña se ejecuta tal cual. Si la contraseña es incorrecta, ese servidor sale con error y la próxima vez se pide otra.

## Contenedores

![Pestaña Contenedores con la lista de contenedores y sus botones](manual/10-contenedores.png)

**Para qué sirve:** manejar Podman o Docker sin escribir comandos.

**Cómo se usa:**

1. Abre la pestaña **Contenedores**. SSHorus detecta Podman o Docker solo.
2. Selecciona contenedores y usa **Iniciar**, **Parar**, **Reiniciar** o **Eliminar**.
3. En cada fila tienes **Logs** y **Terminal dentro del contenedor**.
4. Pulsa **Nuevo contenedor**, elige una plantilla (Nginx, PostgreSQL, Redis…) y pulsa **Crear y arrancar**.
5. En **Compose** añade la carpeta de tu proyecto y usa **Levantar** o **Bajar**.
6. En **Limpieza** ves cuánto espacio ocupan y pulsas **Limpiar todo…**.

**Notas:**

- Con root o sudo, arriba eliges **Usuario**: tú, **root**, cada usuario con contenedores propios o
  **Todos** (con una columna «Usuario»). Lo que hagas se ejecuta como el dueño de cada contenedor.
- La columna **Al reiniciar** (también en **Inspeccionar**) indica si cada contenedor volverá a arrancar solo al
  reiniciar el servidor (**Activado** / **No activado**), comprobando su política de reinicio, `podman-restart.service`
  o `docker.service`, unidades systemd/Quadlet (como `podman-compose@*.service`) y *linger*. Puedes activarlo o
  desactivarlo por fila o en lote. Si sale **Sin datos**, pasa el ratón por encima: dice qué no se pudo leer y por qué.
- **Proyectos de podman-compose** (como `seguimiento_siu`): **Hacer que arranque solo…** propone lo que falta, como el
  dueño del proyecto: habilitar su servicio `podman-compose@<proyecto>` o, si todavía no existe, crear la plantilla y
  registrar el proyecto antes, con *linger* para el usuario. Si no hay podman-compose (solo el plugin docker-compose),
  propone la otra forma: cada contenedor con la política de reinicio y `podman-restart.service`, y **Editar compose…**
  para poner `restart: always` (o `unless-stopped`) en el archivo, para que no se pierda al volver a crearlos. Primero
  ves los comandos exactos; luego va en segundo plano y al terminar dice si ya arranca solo.
- En **Imágenes** marca las casillas (o `Espacio`; `Ctrl+A` todas) y pulsa **Eliminar…**: las que usa un contenedor
  se quedan salvo que marques **Forzar**. **Detalles** (o `Intro`) muestra la imagen y qué contenedores la usan.
- **Limpiar sin usar** (Imágenes) enseña antes qué se borra y cuánto se libera. Por defecto solo borra las **sin
  nombre** (restos de compilaciones y de versiones viejas); con **Incluir también las que tienen nombre** borra todas
  las que no usa ningún contenedor (luego habría que volver a descargarlas). Si el botón está gris, debajo dice por qué.
  **Volúmenes** y **Redes** tienen el mismo botón. Con **Todos**, las tres limpiezas funcionan: cada usuario limpia lo
  suyo (la revisión dice cuántos de cada uno).
- Clic en un puerto de un contenedor → **Abrir túnel a mi PC…** para usarlo en tu navegador.
- En **Imágenes**, el botón de vulnerabilidades te lleva a Administración → Vulnerabilidades.
- **Levantar**, **Actualizar** (con la opción de volver a construir las imágenes propias) y **Descargar imagen** van
  **en segundo plano** (ver [Tareas en segundo plano](#tareas-en-segundo-plano)): puedes cerrar la ventana o ir a otra
  pestaña. La salida en vivo junta las líneas de progreso (una por capa o contenedor). El botón **Tareas** de arriba
  abre la lista con solo las de Contenedores de ese servidor.
- Si Compose dice **«Ya existe un contenedor con ese nombre»** (por ejemplo, el proyecto se levantó antes con
  podman-compose o a mano), la tarea muestra **Ver y arreglar**: ves el contenedor viejo (imagen, estado, de dónde
  viene y sus volúmenes) y **Reemplazar el contenedor viejo y volver a intentarlo** lo para y lo borra como su dueño,
  sin borrar volúmenes, y repite la tarea. Si sus datos no están en un volumen con nombre o en una carpeta del
  servidor, sale un aviso en rojo y hay que marcar una casilla antes.
- En un proyecto de Compose, **Editar compose** abre el archivo en el editor de SSHorus como su dueño (con sudo si es
  de otro usuario): al guardar conserva dueño, grupo y permisos y la primera vez hace una copia
  `.bak-sshorus-<fecha>`. Después pulsa **Aplicar cambios (up -d)**. **Abrir carpeta** la muestra en **Archivos**
  (el explorador usa tu usuario, sin sudo: si la carpeta es de otro usuario y no puedes entrar, te lo dice).

## Bases de datos

**Para qué sirve:** ver cómo está hecha una base de datos del servidor (tablas, columnas, índices y relaciones) sin
instalar nada en tu PC. Solo lee: no cambia ni consulta datos.

**Cómo se usa:**

1. Abre la pestaña **Bases de datos**. SSHorus busca PostgreSQL y MySQL/MariaDB en el servidor (por sus puertos y
   sockets) y en los contenedores (los tuyos; con sudo, también los de root y de otros usuarios).
2. Para un archivo **SQLite**, pulsa **SQLite…** y escribe su ruta en el servidor (no se busca por el disco).
3. Elige una base de la lista. SSHorus entra sin contraseña si puede: dentro del contenedor, como `postgres` o root
   con sudo, o como tu usuario. Si no puede, pulsa **Entrar con usuario y contraseña** y marca **Guardar** si quieres
   que la recuerde para esa base.
4. Elige la base de datos arriba (si hay varias) y busca una tabla o columna. Pulsa una tabla para ver sus columnas
   (tipo, si admite nulo, valor por defecto y clave primaria 🔑), índices y claves foráneas; pulsa una clave foránea
   para ir a la tabla a la que apunta.
5. **Diagrama** dibuja las tablas como cajas y una flecha por cada clave foránea. Con una búsqueda, solo esas tablas y
   las que se relacionan con ellas.
6. **Copiar DDL** copia la definición de la tabla (`CREATE TABLE …`).

**Notas:**

- Las filas son aproximadas (las estadísticas de la base de datos); contarlas de verdad cargaría el servidor.
- La contraseña nunca va en la línea de comandos: viaja por la entrada estándar y el programa la recibe por su
  variable (`PGPASSWORD`, `MYSQL_PWD`). La guardada está en la bóveda (o el llavero) y se borra con el servidor. La
  papelera de arriba la olvida.
- Hace falta el programa cliente en el servidor (`psql`, `mysql`/`mariadb` o `sqlite3`); en un contenedor se usa el
  de la imagen.
- Con un esquema enorme puede tardar: **Cancelar** lo detiene. Cada consulta tiene un límite de 30 s.
- Los asistentes de IA pueden pedir el mismo esquema con `get_db_schema` (solo con la contraseña guardada o sin
  contraseña, y sin sudo).

## Monitor y alertas

![Pestaña Monitor con gráficas de CPU, memoria y red](manual/11-monitor.png)

**Para qué sirve:** ver en vivo cómo va el servidor y recibir un aviso si algo se dispara.

**Cómo se usa:**

1. Abre la pestaña **Monitor**. Verás CPU, memoria, red, carga, discos y procesos.
2. En **Cada** elige cada cuántos segundos se actualiza.
3. Pulsa **Todas las conexiones** para ver un resumen de todos tus servidores abiertos.
4. Para cerrar un proceso que se ha colgado, pulsa **Terminar** en su fila.
5. Pulsa la **campana** para configurar las alertas.
6. Marca **Avisar cuando algo pase del límite**, ajusta Disco, Memoria y CPU, y pulsa **Guardar**.

**Notas:**

- Con alertas activas, el servidor se revisa cada 30 s aunque no mires la pestaña.
- Avisa una sola vez hasta que el valor vuelva a bajar.
- En **Por usuario**, las filas con una caja son contenedores de Podman sin root: un número como `590822` es el
  usuario de dentro de un contenedor (por ejemplo, la base de datos). Pulsa la fila para ver de quién es, en qué
  contenedor corre y **Ver en Contenedores**. Para pararlo, mejor desde **Contenedores** que con **Terminar**: si
  es una base de datos, la aplicación que la usa deja de funcionar.

## Túneles

![Pestaña Túneles con un túnel local a PostgreSQL activo](manual/12-tuneles.png)

**Para qué sirve:** usar en tu PC un servicio del servidor (una base de datos, un panel web) sin abrir puertos.

**Cómo se usa:**

1. Abre la pestaña **Túneles** y pulsa **Nuevo túnel**.
2. Elige una plantilla (**PostgreSQL**, **MySQL**, **Redis**, **Panel web**, **SOCKS**) o el tipo a mano.
3. Revisa los puertos y pulsa **Guardar y activar**.
4. Usa el servicio en tu PC, por ejemplo en `localhost:5432`.
5. Usa el interruptor de la fila para activar o desactivar el túnel.

**Notas:**

- **Local**: un servicio del servidor aparece en tu PC. **Remoto**: lo contrario. **SOCKS**: navegar como si estuvieras en el servidor.
- Marca **Activar automáticamente al conectar a este servidor** para no tener que hacerlo cada vez.

## Administración

![Pestaña Administración con la lista de usuarios](manual/13-administracion.png)

**Para qué sirve:** gestionar usuarios, grupos, puertos y sitios web del servidor sin escribir comandos.

**Cómo se usa:**

1. Abre la pestaña **Administración**. Arriba ves si tienes permisos (**root**, **sudo**) o **Solo lectura**.
2. En **Usuarios** pulsa **Crear usuario**, o selecciona uno y usa **Editar**, **Llaves SSH**, **Contenedores** (ver y dar/quitar acceso a Podman, *linger* y Docker), **Bloquear** o **Eliminar**.
   - **Nuevo usuario con clave…** crea un usuario **sin contraseña** que solo entra con su llave SSH. Pega la
     llave pública, elige una de `~/.ssh` de tu equipo (solo aparecen las `.pub` válidas) o **genera una
     nueva** (ed25519; la privada se queda en tu equipo, con frase opcional). Si sshd limita el acceso con `AllowGroups`, te ofrece añadir el grupo; si
     usa `AllowUsers`, te avisa y, al terminar, puedes añadirlo con un cambio aparte. También puedes activar
     *linger* y **darle sudo**: entonces le pone una contraseña que solo sirve para sudo (generada, o la que
     escribas), te la muestra una vez con **Copiar** y SSHorus la guarda como contraseña de sudo del servidor.
     Sigue entrando solo con su llave: sshd no le deja usar la contraseña para entrar. Al acabar prueba la
     conexión con esa llave y te ofrece **guardar el servidor** en SSHorus con ese usuario.
3. En **Grupos** pulsa **Crear grupo**, o usa **Miembros**, **Renombrar** o **Eliminar**.
4. Antes de cada cambio verás el comando exacto. Pulsa **Ejecutar** para aplicarlo.
5. En **Conectados ahora** ves quién está dentro y puedes **Cerrar sesión**.
6. **Historial** guarda lo que has cambiado desde SSHorus.

**Puertos y sitios web:**

- **Puertos**: cada puerto abierto, con su programa, usuario y servicio. **Túnel** lo abre en tu PC.
- **Sitios web**: los sitios de nginx y Caddy, con dominios, HTTPS, caducidad del certificado y su registro de visitas. Tienes **Comprobar configuración**, **Recargar** y **Tráfico** (análisis bajo demanda de peticiones, IPs aproximadas, errores 4xx/5xx, gráfica por hora/día, rutas y orígenes; corre con prioridad mínima y tope de 8 MB para no cargar servidores pequeños). Si un sitio no tiene log o usa uno compartido, puedes activar un registro dedicado con rotación automática desde el propio diálogo. Va como tarea en segundo plano con sus pasos a la vista (copia en `/var/backups/sshorus`, carpeta con el dueño correcto y, con SELinux, contexto `httpd_log_t`, editar, validar, recargar y una visita de prueba); si algo falla o la cancelas antes de recargar, el archivo queda como estaba y el error dice la línea que falló. El registro queda en `/var/log/caddy/<dominio>.log` o `/var/log/nginx/<dominio>.access.log`; **Quitar registro…** lo deshace (el archivo no se borra).

![Administración → Puertos con los puertos en escucha y su programa](manual/13b-puertos.png)

![Administración → Sitios web con los dominios de nginx y su certificado](manual/13c-sitios.png)

**Con y sin sudo:**

- Sin sudo puedes mirar casi todo, pero no cambiar nada.
- Si tienes sudo, pulsa **Tengo sudo: introducir contraseña** (o **Cambiar contraseña de sudo…**).
- En **Puertos**, **Ver todos con sudo** muestra también los procesos de otros usuarios.

**Mapa (diagrama de la infraestructura):**

![Mapa de un proyecto: Internet, cortafuegos, puertos, nginx, sitios, contenedores por usuario y la base de datos de otro servidor](manual/13d-mapa.png)

- **Administración → Mapa** dibuja el servidor como un diagrama de arquitectura: Internet → cortafuegos →
  puertos abiertos → proxy web (nginx, Caddy…) → sitios (con su certificado) → apps, contenedores y
  servicios → bases de datos. Se genera solo; no instala nada en el servidor.
- Para un **proyecto**: clic derecho en el proyecto → **Mapa**. Pone todos sus servidores conectados en el
  mismo lienzo y une con una línea naranja discontinua las conexiones entre ellos (por ejemplo, la app de
  `web-prod` → PostgreSQL de `db-01`). **Conectar** abre los que falten.
- Dentro de cada servidor hay una caja por usuario (**sistema**, el tuyo y los demás). Con **sudo** se ven
  los de **todos los usuarios**: sus contenedores rootless, sus servicios `systemctl --user` y sus
  procesos. Sin sudo solo ves lo tuyo (aparece un aviso).
- Color de cada nodo: verde bien, amarillo aviso (p. ej. certificado que caduca pronto), rojo caído y gris
  parado. Además, si no está bien, lleva un icono en la esquina (⚠ aviso, ⊗ error, ⏸ parado) y, al pasar el
  ratón, su estado en palabras («Activo», «Parado», «Expuesto»…). Los nombres largos se recortan: pasa el ratón
  para verlos enteros.
- Si una columna tiene muchos puertos o contenedores, se ven los primeros (antes los que tienen problemas) y el
  resto queda en una tarjeta **«+N puertos»**: clic en ella para verlos, o **Mostrar todo** arriba.
- Arrastra para moverte, rueda para acercar, **Ajustar** para verlo entero y el botón de la mira (junto a
  **Ajustar**) para centrar el nodo elegido. Filtros: **Ocultar locales**,
  **Ocultar sistema** y los usuarios que quieras ver (o **Todos**).
- Clic en un nodo (o **Tab** hasta él e **Intro**): sus detalles y un botón para ir a **Puertos**, **Sitios
  web** o **Contenedores**. **Esc** cierra el panel. La **Leyenda** (abajo a la izquierda) se abre con un clic: tipos de nodo,
  estados y qué significa cada línea.
- **Exportar**: imagen PNG, SVG o texto Mermaid (archivo o copiado).

**Mapa → Cortafuegos:**

- Clic en el cortafuegos (el escudo, después de Internet). Si está apagado también aparece, en amarillo.
- Arriba ves su estado y qué pasa con lo que no encaja en ninguna regla (por ejemplo «Entrada: lo que no está
  en la lista se bloquea»). Debajo, cada regla en una frase: «Permite entrar por TCP 443 (HTTPS) desde cualquier
  sitio». Clic en la frase para ver la regla tal como está en el servidor.
- Los avisos amarillos cruzan el cortafuegos con los puertos: **escucha pero está bloqueado** (desde fuera no
  llega), **abierto sin nada escuchando** (sobra la regla) y, en rojo, **lo publica Docker** (se puede llegar
  aunque el cortafuegos diga que no).
- **Creadas por Docker/Podman**: las reglas que ponen los contenedores. No las toques a mano: se rehacen solas.
- Hace falta **sudo** para leer las reglas; sin él sale **Escribir la contraseña de sudo**.
- Con firewalld o ufw puedes cambiarlo (nftables e iptables, por ahora solo se ven):
  - **Abrir puerto o servicio…**: puerto o rango (443, 8000-8010), TCP o UDP, o un servicio (`https`) o perfil de
    ufw (`Nginx Full`). En **Desde** puedes poner una IP o red para abrirlo solo a ella. En firewalld eliges la
    zona (por defecto, la de la interfaz por la que entras).
  - La **papelera** de una regla la quita. Si es la que deja entrar tu conexión SSH, está desactivada: te
    quedarías fuera.
  - **Activar…** enciende un cortafuegos apagado (pide marcar una casilla) y antes abre el puerto de SSH.
  - Siempre ves los **comandos exactos** antes de **Aplicar**, y el cambio va como tarea en segundo plano.
- **A prueba**: en firewalld todo cambio, y en ufw quitar reglas o activarlo, se aplica a prueba. Si toca el
  acceso, SSHorus prueba a entrar con una conexión SSH nueva y, si no puede, lo deshace enseguida. Después tienes
  5 minutos para pulsar **Hacer permanente** (firewalld) o **Mantener** (ufw) en el panel o en el aviso de la
  tarea; si no lo haces, el servidor lo deshace solo (aunque se haya cortado la conexión). **Deshacer ahora** lo
  quita al momento.

**Cerrar un puerto:**

Un puerto está abierto porque un programa lo escucha. Se puede cerrar de dos formas: **bloquearlo en el
cortafuegos** (el programa sigue funcionando dentro del servidor, pero desde fuera ya no se llega) o **parar lo
que lo abre** (un servicio, un programa o un contenedor).

- En **Puertos**, el botón **⊘** de la fila (o clic derecho → **Cerrar…**); en el **mapa**, clic en un puerto →
  **Cerrar…**. Solo sale en los puertos expuestos (los «Solo local» ya no se ven desde fuera).
- SSHorus mira quién lo abre, te lo explica en una o dos frases y ofrece **solo lo que funciona**, con la
  recomendada marcada:
  - **Servicio** (nginx, …): bloquearlo en el cortafuegos, **Parar el servicio** (vuelve al reiniciar) o **Parar y
    desactivar** (ya no arranca).
  - **Programa suelto**: bloquearlo en el cortafuegos o **Terminar el programa**.
  - **Contenedor de Docker o de Podman con root**: publican el puerto **saltándose el cortafuegos**, así que
    bloquearlo ahí no basta. Lo mejor es **Publicarlo solo en local** (en el compose, `"8080:80"` pasa a
    `"127.0.0.1:8080:80"`: **Abrir en Contenedores** y **Editar compose**) o **Parar el contenedor**.
  - **Contenedor de Podman sin root**: sí respeta el cortafuegos, así que puedes bloquearlo ahí y el contenedor
    sigue en marcha.
- Si el contenedor es de otro usuario (con sudo y **Todos**), se para **como su dueño**, igual que en Contenedores.
- Antes de **Aplicar** ves los **comandos exactos**. Bloquear en el cortafuegos va **a prueba** (firewalld o ufw),
  como en el mapa: si no lo confirmas en 5 minutos, se deshace solo.
- El puerto de **SSH** (por donde entra SSHorus) **nunca** se cierra desde aquí: te quedarías fuera.

## Vulnerabilidades

![Pestaña Vulnerabilidades con el resumen por gravedad y la tabla](manual/14-vulnerabilidades.png)

**Para qué sirve:** saber si el software del servidor tiene fallos de seguridad conocidos y cómo arreglarlos.

**Cómo se usa:**

1. Ve a **Administración → Vulnerabilidades** y pulsa **Analizar**. Tarda unos minutos.
2. Arriba ves el **resumen**: Crítica, Alta, Media y Baja. Pulsa una para ver solo esas.
3. Filtra con la búsqueda o con **Solo con arreglo**.
4. Pulsa una fila para ver el **detalle**: versión instalada, versión arreglada, enlaces y **Cómo arreglarlo**.
5. Usa **Copiar** o **Insertar en terminal** con el comando de arreglo. Revísalo y pulsa `Enter` tú.
   O pulsa **Arreglar** (o **Arreglar todo lo que tiene solución**): enseña el comando, lo ejecuta como root al
   confirmar y luego vuelve a comprobar. El resultado sale **paquete por paquete**: *Arreglado*, *Instalado, falta
   reiniciar* (servicios o el servidor), *Sin versión corregida en tus repos todavía* o *Falló* con la línea de
   `dnf`/`apt` que lo explica.
6. El botón **Historial de análisis** abre los 20 últimos análisis. **Exportar** lo guarda en JSON o Markdown.

**Con y sin sudo:**

- Sin sudo se analizan el sistema y tus contenedores, no los de otros usuarios ni los de root. Pulsa **Analizar con sudo** si lo tienes.
- Si la contraseña de sudo (guardada o la de la conexión) no funciona, verás el aviso y el análisis sigue sin sudo. Pulsa **Escribir otra contraseña** y vuelve a analizar.
- Con sudo, el botón **Usuarios** elige de qué usuarios se miran los contenedores.

**Notas:**

- La lista sale de OSV.dev, de la herramienta de tu distro y de Trivy si está instalado. Nunca de una IA.
- A OSV.dev solo se envían nombres y versiones de paquetes. **ver qué se envía** te lo enseña.
- **Cancelar** detiene el análisis también en el servidor. SSHorus nunca ejecuta arreglos solo.
- **Aún no en tus repos**: la distro ya publicó la versión corregida, pero los repositorios de tu servidor todavía no
  la traen (Rocky y AlmaLinux suelen ir unos días detrás de Red Hat). Actualizar ahora no la quita; vuelve a
  comprobar en unos días.
- **¿Sigue apareciendo?** Abre el detalle: **Por qué sigue apareciendo** lo explica (falta reiniciar, el servidor
  arranca con el kernel viejo, tus repositorios aún no la tienen, viene de una imagen…). Si el servidor se reinició
  después del análisis, arriba sale un aviso: pulsa **Volver a comprobar**.

## Auditar servidor

![Pestaña Auditoría con la nota general, la nota por categoría y las comprobaciones](manual/14b-auditoria.png)

**Para qué sirve:** revisar la seguridad del servidor de una vez y saber qué arreglar primero.

**Cómo se usa:**

1. Ve a **Administración → Auditoría** y pulsa **Auditar servidor**. Tarda unos segundos y no instala nada.
2. Arriba ves la **nota general** (0–100 y de A a F) y la nota de cada categoría. Pulsa una para ir a ella.
3. Cada comprobación sale como bien, aviso, mal o sin comprobar. Pulsa la flecha para ver a qué afecta y el comando.
4. **Arreglar** enseña el comando exacto y lo ejecuta como root al confirmar. Lo que puede cortar el acceso
   (SSH, cortafuegos, reiniciar) pide escribir **ARREGLAR**. Después pulsa otra vez **Auditar servidor**.
5. La lista de arriba guarda las auditorías anteriores. Cada una se compara con la anterior: **mejoró**,
   **empeoró** o **nuevo**.
6. **Markdown** y **HTML** la exportan. **Explicar con IA** te enseña antes el texto que se envía.

**Qué revisa:** SSH (root, contraseña, claves), usuarios (sudo, sudo sin contraseña, cuentas sin
contraseña, UID 0), puertos abiertos y cortafuegos, actualizaciones y reinicio pendiente, el último análisis
de vulnerabilidades, certificados que caducan en menos de 30 días, contenedores (`--privileged`, root,
puertos), servicios caídos, disco, memoria, intentos de entrada y fail2ban, permisos (`/proc` con
`hidepid`, `/etc/shadow`, `/etc` escribible por todos, configuración web, `cron`) y **Qué pueden ver tus
usuarios** (túneles SSH de usuarios sin sudo, servicios en `127.0.0.1`, carpetas `HOME` abiertas, acceso a
Docker y logs). Para ver el desglose cuenta por cuenta y arreglar cada punto, abre **Administración → Qué
pueden ver** (o pulsa **Ver detalle por usuario** en ese apartado).

**Notas:**

- Sin sudo se revisa lo que se puede; lo demás sale **sin comprobar**. Pulsa **Con sudo…** para verlo todo.
- No lanza el escáner de vulnerabilidades: usa el último análisis (o pulsa **Analizar**).
- SSHorus nunca arregla nada solo. Con un problema grave, la nota general no pasa de C (75).
- **Contenedores de los usuarios:** con sudo también revisa los contenedores sin root (Podman) de cada usuario,
  entrando como su dueño: `--privileged`, montajes peligrosos (`/`, `/etc`, el socket de Docker o Podman…), puertos
  en todas las interfaces, imágenes `latest` o de hace más de 180 días, root dentro, sin límite de memoria y
  usuarios sin *linger* (sus contenedores se paran al cerrar la sesión). Se arreglan solos el *linger*
  (`loginctl enable-linger`, seguro) y el límite de memoria (1 GB con `podman update`, pide **ARREGLAR**); lo demás
  se explica, porque hay que volver a crear el contenedor.

## Auditar proyecto

**Para qué sirve:** auditar todos los servidores de un proyecto a la vez y compararlos.

**Cómo se usa:**

1. En la barra lateral, clic derecho en el proyecto → **Auditar proyecto…** (o el botón del **Panel del proyecto**).
2. Verás la nota del último informe de cada servidor, la media y **lo que más se repite**. Pulsa
   **Auditar los N servidores**: se auditan 3 a la vez, en segundo plano (puedes cerrar la ventana; la tarea sigue
   en la esquina, con **Cancelar**).
3. Pulsa la flecha de un servidor para ver sus problemas, el botón de recargar para auditar solo ese, y el de abrir
   para ir a su **Administración → Auditoría** (con **Arreglar** y la IA).

**Notas:**

- Usa la pestaña abierta del servidor o conecta aparte con lo guardado (y la cierra al terminar). Si falta la
  contraseña o la huella, ese servidor sale como **No se pudo** y los demás siguen: conéctate una vez y repítelo.
- Sin sudo guardado (ni sudo sin contraseña) se audita igual y sale marcado **sin sudo**.

## Auditoría programada

**Para qué sirve:** repetir la auditoría sola y enterarte si algo empeora.

**Cómo se usa:**

1. En **Administración → Auditoría** (un servidor) o en **Auditar proyecto** (todos los del proyecto), elige
   **Repetir cada día** o **Repetir cada semana** en el selector con el calendario.
2. Debajo verás cuándo toca la próxima y cómo fue la última («Sin cambios», «Empeoró: …», «No se pudo: …»).
3. Si algo empeora (la nota baja, una comprobación pasa de bien a aviso o mal, o sale un problema nuevo) aparece un
   aviso con **Ver**: enseña qué empeoró, qué es nuevo y qué mejoró, con **Abrir en Administración** para
   arreglarlo. Si no cambia nada no avisa: la auditoría queda en el historial.

**Notas:**

- **Solo funciona con SSHorus abierto.** Si estaba cerrado, al abrirlo hace lo atrasado **una vez** (no una por
  cada día perdido). Mira cada 5 minutos, así que la hora se corre un poco.
- Audita como **Auditar proyecto**: sin preguntar nada, con la contraseña guardada (o la llave) y el sudo guardado;
  como mucho 3 servidores a la vez. Lo que no conecta así se dice en un aviso y se vuelve a intentar la próxima
  vez que toque.
- Con SSHorus **bloqueado** (PIN) no se audita: se apunta y se hace al desbloquear.
- La programación se guarda en este equipo (no viaja con la copia en GitHub).

## Configuración y seguridad del servidor

**Para qué sirve:** ver en un solo sitio cómo está configurado y protegido el servidor, explicado en simple, y
cambiarlo donde se puede. La Auditoría lo puntúa; esta pestaña es para verlo y tocarlo.

**Cómo se usa:**

1. Ve a **Administración → Configuración**. Se lee sola al abrirla (solo lee, con poca prioridad). Con
   **Con sudo…** se ve todo.
2. Cada sección dice su estado en una frase. Pulsa para abrirla: verás el detalle, los botones de cambio y las
   mismas comprobaciones de la Auditoría (con su **Arreglar**).
3. Cada cambio enseña antes el comando exacto. Lo peligroso pide escribir **CAMBIAR**. Se ejecuta como tarea en
   segundo plano y la pestaña se vuelve a leer al terminar. Queda en **Historial**.

**Secciones:**

- **SELinux** (Rocky, Alma, Fedora): modo ahora y al arrancar, pasar a Enforcing, Permissive solo hasta reiniciar,
  los permisos (booleans) útiles para nginx, Caddy y contenedores, y las **denegaciones recientes** explicadas
  («El servidor web (nginx) no pudo conectarse al puerto 8080»). **Arreglar** solo aparece si la solución es
  segura y concreta (un boolean, marcar un puerto o una carpeta como web); si no, te dice qué hacer y te da el
  comando para copiar (p. ej. montar el volumen del contenedor con `:Z`).
- **AppArmor** (Debian, Ubuntu): si está activo, sus perfiles y las denegaciones recientes. Solo lectura.
- **SSH:** puerto, root, contraseña y claves. Desactivar contraseñas o root comprueba antes que no te quedas
  fuera (tienes llave, no entras como root) y pasa `sshd -t` antes de recargar; las sesiones abiertas siguen.
- **Cortafuegos:** estado y **Abrir el cortafuegos en el mapa** (allí están las reglas y los cambios a prueba).
- **Actualizaciones automáticas:** `dnf-automatic` (solo seguridad o todo) o `unattended-upgrades`; activar,
  cambiar o desactivar. En openSUSE y Alpine dice «no aplica» y qué hacer.
- **fail2ban:** cárceles, intentos fallidos y direcciones bloqueadas, con **Desbloquear** (avisa si eres tú).
- **Usuarios con sudo**, **red del kernel (sysctl)** con los valores recomendados y **hidepid** (que los usuarios
  no vean los procesos de los demás).

**Notas:** lo que no existe en el servidor sale como **No aplica**; lo que necesita sudo dice qué falta. El
puerto de SSH no se cambia desde aquí.

## IA para explicar informes

![Ajustes → IA para explicar informes con URL, modelo y token](manual/15-ia.png)

**Para qué sirve:** que una IA te explique con palabras sencillas un informe de vulnerabilidades. Es opcional.

**Cómo se usa:**

1. Ve a **Ajustes → IA para explicar informes** y activa **Activar**.
2. Escribe la **URL base** (por ejemplo `https://api.openai.com/v1`, o `http://localhost:11434/v1` para Ollama).
3. Escribe el **Modelo** y pega el **Token** (Ollama local no lo necesita). Pulsa **Guardar**.
4. Pulsa **Probar conexión** para comprobarlo.
5. En **Vulnerabilidades** o **Auditoría**, pulsa **Explicar con IA**, revisa el texto exacto que se enviará y pulsa **Enviar**.

**Notas:**

- No se envían el nombre del servidor, su IP, usuarios, rutas ni contraseñas.
- La IA solo explica. Los comandos que proponga nunca se ejecutan solos.
- No es lo mismo que el MCP: aquí SSHorus le pregunta a la IA, no al revés.

## GitHub

![Ventana de GitHub con la cuenta conectada](manual/16-github.png)

**Para qué sirve:** usar tu cuenta de GitHub con tus servidores: llaves, repositorios, despliegues y copia de tu configuración.

**Cómo se usa:**

1. Pulsa el botón **GitHub** de la barra lateral.
2. En **Cuenta**, pega un token y pulsa **Conectar**, o usa **Iniciar sesión en GitHub** con un código.
3. En **Llaves SSH**: **Añadir a authorized_keys** pasa tus llaves de GitHub a un servidor. **Subir a GitHub** sube la llave de tu PC.
4. En **Repositorios**, pulsa **Clonar…** para clonar un repo en un servidor.
5. En **Despliegues**, crea una **Nueva receta** y pulsa **Actualizar desde GitHub** cuando quieras desplegar.
6. En **Sincronizar**, **Subir copia cifrada** guarda tu configuración en un gist privado. En otro PC usa **Descargar y ver**.

**Notas:**

- En **Actions** ves las últimas ejecuciones y puedes lanzar un workflow.
- Las contraseñas y llaves privadas nunca se suben al gist.

## PIN y bloqueo

![Pantalla de bloqueo pidiendo el PIN, con el enlace «Olvidé mi PIN»](manual/17-pin.png)

**Para qué sirve:** cifrar tus contraseñas guardadas y bloquear SSHorus cuando no lo usas.

**Cómo se usa:**

1. Pulsa el **candado** de la barra de pestañas → **Proteger con PIN** (o acepta la oferta al abrir SSHorus).
2. Escribe un PIN de 6 números dos veces y pulsa **Crear PIN**.
3. Para bloquear al momento: candado → **Bloquear ahora**, o `Ctrl+Shift+L`.
4. Para desbloquear, escribe tu PIN.
5. En **Ajustes → Seguridad** eliges **Bloquear tras** (5 a 60 min, o **Nunca**) y puedes **Cambiar PIN**.

**Si olvidaste el PIN:**

1. En la pantalla de bloqueo pulsa **Olvidé mi PIN**.
2. Escribe `BORRAR` y pulsa **Borrar y empezar de nuevo**.
3. Pierdes las contraseñas guardadas y los tokens (GitHub, asistentes de IA e IA de informes). Conservas servidores, proyectos, comandos, túneles y ajustes.

**Notas:**

- Al bloquear, las conexiones siguen abiertas.
- Tras 5 PIN incorrectos hay que esperar, cada vez más (hasta 15 min). Nunca se borra nada por fallar.

## Asistentes de IA (MCP)

![Ajustes → Asistentes de IA (MCP) con permisos por servidor y la configuración para copiar](manual/18-mcp.png)

**Para qué sirve:** que un asistente como Claude Code, Codex o Claude Desktop te ayude con tus servidores a través de SSHorus, sin ver nunca tus contraseñas ni tus llaves.

**Cómo se usa (lo más fácil: emparejar):**

1. Ve a **Ajustes → Asistentes de IA (MCP)** y activa **Activar el servidor MCP**.
2. Dile a tu IA (Claude Code, Codex, Gemini CLI…): «conéctate a SSHorus ejecutando `sshorus-mcp pair`». La orden
   exacta está en **Asistentes conectados → Conectar un asistente** (con la ruta completa si hace falta).
3. SSHorus muestra **Conectar un asistente** con lo que pide conectarse (programa, PID y carpeta). Elige para cada
   servidor **Sin acceso**, **Solo lectura** (por defecto) o **Completo** y pulsa **Aceptar**. Si no respondes en
   2 minutos, se rechaza solo.
4. La IA termina sola: guarda su llave en el llavero del sistema (nunca la ves ni la copias) y se apunta en su
   configuración. En Claude Code, reconecta con `/mcp` o abre una conversación nueva.
5. Cuando quiera cambiar algo, SSHorus te pregunta: **Permitir una vez**, **Permitir siempre…** o **Denegar**.

**Por HTTP directo, sin puente ni token (Claude Code):**

1. Copia **Claude Code (HTTP, sin token)** de **Asistentes conectados** y ejecútalo en una terminal de tu PC. Es así:

```bash
claude mcp add --transport http sshorus http://127.0.0.1:47821/mcp
```

2. La primera vez que Claude Code lo use (o con `/mcp` → **Authenticate**), se abre tu navegador con **Vuelve a
   SSHorus para aceptar**.
3. En SSHorus sale el mismo aviso **Conectar un asistente**, con su identidad («comprobada» si su ficha está publicada
   en su sitio, como claude.ai; «sin comprobar» si se registró sola), el navegador y a dónde vuelve. Elige sus permisos
   y pulsa **Aceptar**. El navegador vuelve solo a Claude Code.
4. Su acceso dura una hora y se renueva solo; no tienes que volver a aceptarlo. Otros clientes que siguen la
   autorización estándar de MCP (por ejemplo `codex mcp add sshorus --url http://127.0.0.1:47821/mcp` y luego
   `codex mcp login sshorus`) funcionan igual.

Puedes conectar varias IA a la vez. En **Asistentes conectados** ves cada una con su carpeta (o su cliente), cómo se
conectó (**Puente** o **HTTP (OAuth)**), su último uso y sus permisos, con **Cambiar permisos** y **Revocar** (deja de
funcionar al instante, también la renovación por OAuth; las demás siguen igual). Volver a conectar la misma IA
reemplaza su conexión anterior.

**Permisos de cada asistente:** un asistente conectado así usa **solo sus propios permisos** por servidor, los que
elegiste al aceptarlo. La lista **Permisos por servidor** vale para la conexión manual con el token (abajo). «Solo lo
marcado», los usuarios protegidos, «Permitir siempre» y «Aceptar automáticamente» son de cada servidor y valen para
todos.

**Conexión manual (con token):** para asistentes que no pueden emparejarse solos (por ejemplo Claude Desktop).

1. En **Conexión manual (con token)**, pulsa **Copiar** en **Claude Code (puente stdio)**.
2. Pégalo en una terminal de tu PC y pulsa `Enter`. Es un comando así:

```bash
claude mcp add --env SSHORUS_MCP_TOKEN=<token> --transport stdio sshorus -- /ruta/a/sshorus-mcp
```

**Notas:**

- `sshorus-mcp` es el puente que trae SSHorus. Al abrirse, SSHorus lo copia a `~/.local/bin/sshorus-mcp`
  (Windows: `%LOCALAPPDATA%\SSHorus\bin\sshorus-mcp.exe`), una ruta que no cambia aunque uses la AppImage.
- Si la IA ejecuta los comandos en un entorno aislado sin red (sandbox, p. ej. Codex), tendrá que pedirte permiso
  para ejecutar `sshorus-mcp pair` fuera de él.
- Sin llavero del sistema (Linux sin GNOME Keyring ni KWallet) no se puede emparejar: usa la conexión manual.
- Para Claude Desktop, copia el bloque **Claude Desktop** en `claude_desktop_config.json` y reinicia Claude Desktop.
- Lo que solo lee pasa solo. Lo peligroso (`rm -rf`, `sudo`, `reboot`, `reboot_server`…) se pregunta siempre. Si no respondes a tiempo, se deniega.
- **La IA nunca ve tus contraseñas.** Con `sudo …` SSHorus pone la contraseña por ella. Si un programa la pide por su cuenta (`passwd`, `su`, `mysql -p`…), la IA usa `run_with_password`: SSHorus te pregunta qué contraseña usar (la guardada, otra que escribas o ninguna), la escribe en el programa y a la IA le llega la salida con la contraseña tapada (`••••`).
- **Permitir que la IA pida ver la contraseña de sudo** está apagado (recomendado). Si lo enciendes, cada vez te pregunta y, si aceptas, la contraseña queda en la conversación con la IA.
- El botón del **robot** en la barra de pestañas abre **Actividad del asistente**, con todo lo que ha hecho.

**Aceptar automáticamente:** si te cansa aprobar cada paso, en **Ajustes → Asistentes de IA (MCP)** pulsa **Automático…** junto a un servidor donde la conexión con token o algún asistente conectado tiene acceso **Completo** o **Solo lo marcado** (o, en el propio diálogo de permiso, **Aceptar automáticamente en este servidor…**). Solo vale para quien tenga ese acceso ahí: un asistente con **Solo lectura** sigue sin poder cambiar nada.

- **Cambios normales**: lo que no es peligroso pasa sin preguntar.
- **Todo (incluido sudo)**: también lo peligroso y los comandos con sudo. Se marca en rojo y se pide confirmación. Si SSHorus tiene la contraseña de sudo (en memoria o guardada) la usa sin preguntar; si no, la pide una vez.
- Duración: **15 min**, **1 hora**, **hasta cerrar SSHorus** o **siempre**.
- Mientras esté activo verás **Automático** en la barra de pestañas: al pulsarlo se abre una ventana con el detalle por servidor para apagar uno concreto o **Apagar todo** (con confirmación).
- Nunca funciona con SSHorus bloqueado ni en servidores de solo lectura. Cada acción queda en **Actividad del asistente** marcada como «automático», y las peligrosas muestran un aviso.

### Desplegar con la IA

**Para qué sirve:** que Claude Code (u otra IA conectada por MCP) ponga en marcha un proyecto tuyo en un servidor:
un usuario aparte para la app, el código, un contenedor o un servicio, la web con HTTPS y la comprobación final.

**Qué pedirle:** abre Claude Code en la carpeta del proyecto (con el MCP de SSHorus conectado) y dile, por ejemplo:

> Despliega este proyecto en el servidor «vps-1» con el dominio blog.ejemplo.com, usando la receta de SSHorus.

La IA lee primero la receta (`get_deploy_guide`) y te hace unas preguntas: en qué servidor, con dominio o solo con
IP, en qué puerto escucha la app, qué variables necesita, contenedor o programa. Luego va paso a paso:

1. **Mira** el servidor (sistema, memoria, disco, Podman, Caddy o nginx, puertos libres). Esto solo lee: no pregunta.
2. **Comprueba el dominio** (`check_dns`). Si aún no apunta a tu servidor, te dice el registro exacto que tienes que
   crear en tu proveedor de DNS (por ejemplo «registro A blog.ejemplo.com → 203.0.113.7»). Mientras, se puede
   desplegar solo con IP:puerto.
3. **Crea un usuario para la app** (`create_app_user`): sin contraseña y **sin sudo**, con sus servicios siempre en
   marcha (*linger*) y preparado para Podman sin root.
4. **Sube el código** (`upload`). Si puede, lo compila antes en tu PC para no cargar el servidor.
5. **Arranca la app** (`deploy_app`) como servicio de ese usuario, nunca como root: un contenedor de Podman o un
   programa. Escucha solo dentro del servidor (127.0.0.1) y arranca solo al reiniciar. Si falla, la IA ve los
   últimos logs.
6. **Publica la web** con un sitio de Caddy (HTTPS automático) o nginx, de la Biblioteca.
7. **Comprueba** todo (`deploy_status`): el servicio, el puerto, la respuesta de la web y el certificado.

**Qué hace SSHorus:** cada cambio te muestra un diálogo con un resumen y el script completo que se va a ejecutar
(los que usan sudo se preguntan siempre, salvo **Aceptar automáticamente → Todo**). Pone la contraseña de sudo sin
que la IA la vea, rechaza root, el usuario con el que estás conectado y los usuarios protegidos, y anota todo en
**Actividad del asistente**. Para deshacer, la IA tiene el paso inverso de cada uno (`deploy_app` con
`remove`, borrar el sitio, borrar el usuario).

**Permisos:** con **Completo** basta. Con **Solo lo marcado**, usa la plantilla **Despliegue** y añade
**Archivos** (con la carpeta donde se sube el código, p. ej. `/home/tu-usuario/sshorus-deploy`) y **Cortafuegos**
si hay que abrir puertos. Crear el usuario necesita **Usuarios: crear**; arrancar la app, **Contenedores** o
**Servicios**.

**Límites:** hace falta un servidor con systemd (Alpine sin systemd no sirve para `deploy_app`). En Debian y Ubuntu,
para Podman sin root instala antes `dbus-user-session` y `uidmap`. nginx no saca el certificado solo (la IA usa
`certbot` si está). Desde el celular las aprobaciones siguen saliendo en el PC.

## Terminal local y asistentes de IA

**Para qué sirve:** tener en SSHorus una terminal de **tu propio PC** y abrir **Claude Code**, **Codex**, **Antigravity (agy)** u **OpenCode**, que ya saben qué servidores tienes.

**Cómo se usa:**

1. Pulsa el botón del **portátil** en la barra de pestañas (junto a **+**).
2. Elige **Terminal local** o un asistente: **Claude Code**, **Codex**, **Antigravity (agy)** u **OpenCode**. Se abre una pestaña con el icono del portátil (o del robot).
3. Para trabajar en otra carpeta, pulsa **Cambiar carpeta…** en el mismo menú. SSHorus recuerda la última.
4. Si el asistente no está instalado, SSHorus te muestra el comando oficial y, si aceptas, lo ejecuta en una pestaña para que veas la instalación. Al terminar, vuelve a pulsarlo.
5. La primera vez, el asistente te pide iniciar sesión (con tu suscripción o una clave de API): `/login` en Claude Code, o lo que indique cada programa.

**Qué sabe el asistente:** la lista de tus servidores con su alias de `~/.ssh/config` (puede usar `ssh <alias> '<comando>'`), su usuario, host y proyecto, cuáles están conectados, qué servidor estabas mirando y la fecha. Si el **MCP** está activo, también lo tiene configurado, con tus permisos de siempre (menos agy, que solo lo lee de sus propios archivos; a agy el contexto le llega como primer mensaje). Nunca recibe contraseñas, llaves, tokens ni el PIN.

**Enviar a la IA:** en la terminal de un servidor, selecciona un texto, haz clic derecho y elige **Enviar a la IA**. Se pega en el asistente abierto (sin `Enter`) para que añadas tu pregunta.

**Notas:**

- Cerrar la pestaña termina lo que corre en ella y todo lo que lanzó.
- En **Ajustes → Terminal local e IA** eliges qué contexto recibe (y lo puedes ver), y si usa ssh directo, el MCP o las dos cosas.
- Para el ssh directo, exporta los servidores a `~/.ssh/config` (barra lateral → **Nuevo → Exportar**). Los servidores con contraseña solo funcionan por el MCP.
- SSHorus no escribe nada en tu carpeta ni lee la configuración de los asistentes (salvo tu sesión de Claude Code si eliges **Copiar mi sesión**, abajo).

### Claude Code en un servidor con tu cuenta

**Para qué sirve:** usar Claude Code **dentro de un servidor** con la cuenta de tu PC, sin iniciar sesión por el navegador allí.

**Cómo se usa:**

1. En la terminal del servidor, pulsa el botón del **robot** (junto a la llave de sudo).
2. SSHorus mira si Claude Code está instalado en el servidor. Si falta, te enseña el comando oficial (`curl -fsSL https://claude.ai/install.sh | bash`) y **Instalar en la terminal** lo ejecuta para que lo veas.
3. Elige cómo llevar tu cuenta:
   - **Llave de acceso** (recomendada para servidores): oficial y dura un año. Pulsa **Crear la llave en este equipo**: se abre una terminal local con `claude setup-token` y el navegador. Copia la llave (empieza por `sk-ant-oat01-`), vuelve a la pestaña del servidor, pulsa otra vez el robot y pégala.
   - **Copiar mi sesión**: rápido y sin navegador, pero no oficial y compartida: si un equipo renueva la sesión, el otro puede quedarse fuera (vuelve a copiarla).
4. Pulsa **Poner la llave en el servidor** (o **Copiar mi sesión al servidor**) y después **Abrir Claude Code en la terminal**.
5. Para quitarla: robot → **Quitar mi cuenta de este servidor**. Si el servidor ya tenía otra sesión de Claude Code, se repone.

**Notas:**

- La cuenta se pone en el usuario con el que entraste. Quien tenga **root** en el servidor puede usarla.
- La llave o la sesión viajan por la conexión SSH, nunca en un comando ni en el historial; la sesión copiada la lee y la envía el motor de SSHorus, sin pasar por la pantalla. Los asistentes de IA (MCP) no tienen acceso a esto.
- Con la llave, SSHorus añade una línea marcada `# SSHorus: cuenta de Claude Code` a `~/.bashrc`, `~/.profile` (o los que tengas) y la guarda en `~/.config/sshorus/claude-token`. Las terminales que ya estaban abiertas la cargan con el comando que escribe **Abrir Claude Code en la terminal**.
- La llave no sirve para `claude remote-control`: para eso usa **Copiar mi sesión**.

## Ajustes

![Ventana de Ajustes en la sección Apariencia](manual/19-ajustes.png)

**Para qué sirve:** adaptar SSHorus a tu gusto.

**Cómo se usa:**

1. Pulsa el engranaje (**Ajustes**) o `Ctrl+,`.
2. Elige una sección a la izquierda, o escribe en **Buscar ajuste…** (por ejemplo «letra» o «tmux»). Con la ventana estrecha, las secciones salen arriba.
3. Cambia lo que quieras. Los cambios se guardan solos.
4. Pulsa **Listo** para cerrar.

**Lo más útil:**

- **Apariencia → Tema**: elige una tarjeta: **Sistema** (sigue el modo claro u oscuro de tu equipo), **Oscuro**, **Claro**, **Medianoche** (azul profundo), **Arena** (cálido, con la terminal también clara), **Fiordo** (gris suave) o **Alto contraste**. Cambia al momento la interfaz, la terminal y el editor (también el de ventana aparte).
- **Apariencia → Detalles**: **Color de acento** (o «Del tema») y **Tamaño de la letra de la interfaz**. La terminal y el editor tienen su propio tamaño.
- **Terminal**: tamaño y tipo de letra, y **Terminales persistentes (tmux)**.
- **Conexión**: **Reconectar automáticamente** e **Intentos**.
- **Transferencias**: **Transferencias simultáneas** y **Si el archivo ya existe**.
- **Explorador**: **Mostrar archivos ocultos** y **Confirmar antes de borrar**.
- **Atajos de teclado**: cambia cualquier atajo de la app (ver [Atajos de teclado](#atajos-de-teclado)).
- **Avanzado → Diagnóstico**: **Copiar informe**, útil para reportar un problema.
- **Restablecer** vuelve a los valores de fábrica.

## Atajos de teclado

Puedes cambiarlos en **Ajustes → Atajos de teclado**: haz clic en un atajo y pulsa la combinación nueva
(`Esc` cancela; `Retroceso` lo deja sin atajo). Si la combinación ya la usa otra acción, o choca con algo de la
terminal (como `Ctrl+C`) o del sistema, SSHorus te avisa antes. Cada fila tiene su botón para volver al de por defecto.
Las tablas muestran los atajos **por defecto**; `Esc`, `Enter`, `Supr` en una pestaña y los del ratón no se cambian.

En macOS, donde la tabla dice ⌘, usa ⌘ en lugar de Ctrl. Los demás atajos usan Ctrl también en macOS.

**Generales**

| Atajo | Qué hace | En macOS |
|-------|----------|----------|
| `Ctrl+Shift+P` | Paleta de comandos | ⌘⇧P |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Siguiente / anterior pestaña | Ctrl |
| `Ctrl+AvPág` / `Ctrl+RePág` | Siguiente / anterior conexión | Ctrl |
| `Ctrl+Shift+W` | Cerrar la pestaña del servidor (la conexión entera) | ⌘⇧W |
| `Ctrl+B` | Mostrar u ocultar la barra lateral | ⌘B |
| `Ctrl+,` | Ajustes | ⌘, |
| `Ctrl+Shift+L` | Bloquear SSHorus (con PIN) | ⌘⇧L |
| `Supr` en una pestaña | Cerrar esa pestaña | Supr |
| Clic central en una pestaña | Cerrarla | Igual |

Al cerrar un servidor, SSHorus pregunta antes si hay archivos sin guardar o transferencias sin terminar.

**Dentro del servidor** (la pestaña que tienes abierta)

| Atajo | Qué hace | En macOS |
|-------|----------|----------|
| `Ctrl+W` | Cerrar el archivo abierto (pregunta si tiene cambios sin guardar) | ⌘W |
| `Alt+AvPág` / `Alt+RePág` | Sección siguiente / anterior (Archivos, Comandos, Contenedores, Monitor, Túneles, Administración y los archivos abiertos) | ⌥AvPág / ⌥RePág |
| `Alt+Shift+AvPág` / `Alt+Shift+RePág` | Archivo abierto siguiente / anterior | ⌥⇧AvPág / ⌥⇧RePág |
| `` Ctrl+` `` | Mostrar u ocultar la terminal | Ctrl |
| `Ctrl+Shift+M` | Dividir (vista y editor) o quitar la división | Ctrl |

`Ctrl+W` no cierra nunca el servidor: si estás en una sección fija (Archivos, Monitor…) no hace nada, y con el foco
en la terminal es de la shell (borrar palabra). Con la vista dividida cierra el archivo solo si el foco está en el editor.

**Barra lateral**

| Atajo | Qué hace |
|-------|----------|
| Doble clic o `Enter` | Conectar, o ir a su pestaña si ya está abierta |
| `Ctrl` + doble clic, `Ctrl+Enter` o clic central | Abrir otra conexión al mismo servidor (⌘ en macOS) |
| `Shift+F10` | Menú del servidor |
| `→` / `←` | Desplegar / plegar un proyecto o un servidor con varias cuentas |

**Terminal**

| Atajo | Qué hace |
|-------|----------|
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | Copiar / pegar |
| `Ctrl+Shift+F` | Buscar |
| `Enter` / `Shift+Enter` | Siguiente / anterior resultado |
| `Alt+C` | Distinguir mayúsculas en la búsqueda |
| `Esc` | Cerrar la búsqueda |

**Explorador de archivos** (⌘ en lugar de Ctrl en macOS)

| Atajo | Qué hace |
|-------|----------|
| `Enter` | Abrir |
| `Backspace` o `Alt+↑` | Subir de carpeta |
| `Alt+←` / `Alt+→` | Atrás / adelante |
| `Ctrl+L` | Escribir una ruta |
| `Ctrl+F` | Filtrar por nombre |
| `Ctrl+A` | Seleccionar todo |
| `Ctrl` + clic / `Shift` + clic | Añadir a la selección / seleccionar un rango |
| `F2` | Renombrar |
| `Supr` | Eliminar |
| `F5` | Refrescar |
| `Esc` | Quitar la selección |
| Escribir letras | Saltar al archivo que empieza así |

**Editor y comandos**

| Atajo | Qué hace |
|-------|----------|
| `Ctrl+S` | Guardar el archivo en el servidor (⌘S en macOS) |
| `Enter` | Ejecutar el comando en la terminal |
| `Alt+Enter` | Escribir el comando en la terminal sin ejecutarlo |
| `Ctrl+Enter` | Ejecutar y ver el resultado en el panel |
| `Ctrl+Enter` en «Nuevo comando» o en «Ejecutar en varios servidores» | Guardar / ejecutar (⌘ en macOS) |
| `Esc` | Volver o cerrar la paleta |

## Tareas en segundo plano

Lo que tarda (actualizar paquetes, levantar un proyecto de Compose, descargar una imagen, reiniciar el servidor…)
sigue aunque cierres el diálogo que lo lanzó o te vayas a otra pestaña.

- **Abajo a la derecha** aparece una ventanita: «2 tareas» mientras hay alguna en marcha, o «3 terminadas» después.
  Un punto rojo avisa de que alguna falló.
- Al pulsarla ves cada tarea: qué es, en qué servidor, en qué va (la última línea de su salida o el paso), cuánto
  lleva, una barra si se sabe cuánto falta, y los botones **Ver** y **Cancelar**.
- **Ver** la abre en grande: la salida completa en vivo, los pasos, a qué hora empezó y terminó, el resultado,
  **Cancelar** y **Copiar salida**. A la izquierda está la lista de todas.
- **Cancelar** detiene la tarea también en el servidor, con el mismo usuario que la lanzó (root con sudo, o el dueño
  de los contenedores). Cancelar una actualización de paquetes a mitad puede dejarla a medias: luego pulsa **Volver a
  comprobar**.
- Si una tarea lleva un minuto sin escribir nada, sale un aviso: puede seguir trabajando (descargando, instalando) o
  estar atascada.
- Al terminar sale un aviso con **Ver**. Las terminadas se quedan en la lista hasta que cierras SSHorus, las quitas con
  la **X** o pulsas **Vaciar historial**.
- Algunas tareas traen botones propios al terminar: **Ver y arreglar** (nombre de contenedor repetido),
  **Introducir contraseña de sudo**, **Reconectar** (tras un reinicio). Te llevan a la pestaña de ese servidor.

Van en segundo plano: Compose (Levantar, Actualizar, Aplicar cambios), Descargar imagen, Vulnerabilidades → Arreglar,
Actualizar imagen, Auditoría → Arreglar y Arreglar todo lo seguro, y Reiniciar ahora. Las transferencias y
«Ejecutar en varios servidores» tienen su propio panel.

## Historial por servidor

**Para qué sirve:** ver en un solo sitio qué se ha hecho en un servidor desde SSHorus, quién lo hizo y cómo salió.

**Cómo se usa:**

1. Clic derecho en el servidor (barra lateral) → **Historial…**, o en **Administración → Historial** el botón
   **Historial completo**.
2. Sale una lista, lo más nuevo arriba: cambios de Administración, lo que hizo el asistente de IA (y con qué
   permiso), comandos de la Biblioteca, «Ejecutar en varios servidores», tareas en segundo plano terminadas,
   auditorías y análisis del escáner.
3. Busca por texto, filtra por origen o marca **Solo lo que falló**. Haz clic en una fila para ver el comando completo
   y el resultado. En las auditorías, **Abrir en Administración** lleva al informe.
4. **Texto** o **JSON** exporta lo que se ve (con el filtro aplicado) a un archivo.

**Comandos escritos en la terminal (opcional, apagado):**

- Actívalo para todos en **Ajustes → Terminal → Historial por servidor**, o solo para uno con la casilla de abajo de su
  historial.
- Se guarda la línea que se ve en la pantalla al pulsar Enter (cuentan el tabulador y las flechas). **Nunca** lo que
  escribes tras un aviso de contraseña, frase de llave o código, ni dentro de vim, less o top.
- Un pegado de varias líneas guarda solo la primera. No se sabe si el comando salió bien.

**Notas:**

- Todo se guarda **solo en este equipo** (no va a la copia en GitHub). Antes de guardar se tapan con `••••` las
  contraseñas guardadas del servidor, las llaves (`sk-ant-…`, `ghp_…`) y lo que va tras `password=`, `--password`,
  `mysql -p`, `Bearer`… Aun así, **puede contener datos sensibles**: no lo compartas sin mirarlo.
- El asistente de IA **no** puede leer este historial.
- **Borrar comandos y tareas** borra lo de la terminal, la Biblioteca, varios servidores y tareas. Administración, el
  asistente y las auditorías se borran desde su sitio. Al borrar el servidor se borra todo.
- Las tareas en segundo plano se apuntan si su pestaña sigue abierta al terminar.

## Solución de problemas

**«¡La huella del servidor cambió!»**
Si reinstalaste el servidor, es normal: pulsa **Confiar en la nueva huella**. Si no, pulsa **Cancelar** y pregunta al administrador: podría ser un ataque.

**«Usuario o contraseña incorrectos»**
Revisa el usuario y la contraseña en **Editar servidor**. Si dice «el servidor no acepta contraseña», cambia a **Llave SSH**.

**«El servidor rechazó la llave»**
Elige la llave **privada** (sin `.pub`) y comprueba que la pública está en `~/.ssh/authorized_keys` del servidor.

**El servidor pide un código (2FA)**
Escribe el código de tu app de autenticación en **Código de verificación** y pulsa **Verificar**. Si dice «el servidor exige un segundo método», revisa que tienes la llave y el código.

**«El agente SSH no tiene llaves cargadas»**
Carga tu llave con `ssh-add`. En Windows, activa el servicio *Agente de autenticación OpenSSH* o abre Pageant.

**Administración en «Solo lectura»**
Necesitas root o sudo. Pulsa **Tengo sudo: introducir contraseña**. Si el servidor usa doas con contraseña, conéctate como root o usa sudo.

**«tmux no está instalado»**
Pulsa **Escribir el comando en la terminal**, revísalo y pulsa `Enter`. Las terminales nuevas ya serán persistentes.

**Olvidé el PIN**
En la pantalla de bloqueo pulsa **Olvidé mi PIN** y escribe `BORRAR`. Ver [PIN y bloqueo](#pin-y-bloqueo).

**«Llavero del sistema no disponible» (Linux)**
Instala o activa GNOME Keyring o KWallet. Sin llavero, SSHorus te pedirá la contraseña en cada conexión.

**El asistente dice «Abre SSHorus para usar tus servidores» o «SSHorus está bloqueado»**
SSHorus tiene que estar abierto y desbloqueado. Si dice «no está emparejado» o «ya no está emparejado», pídele que ejecute `sshorus-mcp pair` otra vez (si lo conectaste por HTTP, vuelve a autorizarlo: en Claude Code, `/mcp` → **Authenticate**). Si dice «Token incorrecto» con la conexión manual, copia otra vez la configuración desde **Ajustes → Asistentes de IA (MCP)**.

**Lentitud o ventana en blanco en Linux**
Abre SSHorus con `WEBKIT_DISABLE_COMPOSITING_MODE=1 sshorus`.
