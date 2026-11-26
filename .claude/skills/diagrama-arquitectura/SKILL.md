---
name: diagrama-arquitectura
description: Crea o actualiza un diagrama de arquitectura interactivo de SSHorus (estilo AWS, un solo archivo HTML) con zonas, fichas por tipo, flechas numeradas, panel «En palabras simples», marcas de estado y un recorrido animado por escenarios. Úsalo cuando el usuario pida un diagrama de la arquitectura o de un flujo, cuando cambien los módulos (Rust o React) o un flujo que `docs/diagrama-arquitectura.html` muestra, o al cerrar una fase que añade o mueve piezas.
---

# Diagrama de arquitectura

Complementa a `docs/ARQUITECTURA.md` y a los dibujos de `docs/arquitectura/` (el documento largo): el diagrama da la visión **de un vistazo** y el **recorrido animado** de los flujos. El ejemplo completo y vigente es `docs/diagrama-arquitectura.html`: ábrelo antes de hacer uno nuevo.

## Archivos

- `plantilla.html`: estilos, esqueleto, motor y un `spec` mínimo de ejemplo (3 nodos y un escenario). Funciona tal cual al abrirla.
- Un diagrama nuevo = copiar la plantilla y **reemplazar solo el bloque** `<script id="spec" type="application/json">…</script>`. El motor (el `<script>` siguiente) no se toca; si hay que mejorarlo, se cambia en la plantilla y se anota que los diagramas ya hechos conservan el motor viejo.
- Si los datos son inválidos (nodo, icono, flecha o paso inexistente), la página no dibuja y lista los errores arriba. Es la primera comprobación.

## Cómo se trabaja

1. **Reunir la verdad.** Lee `docs/ARQUITECTURA.md`, `docs/PENDIENTES.md`, `docs/MANUAL.md`, `CHANGELOG.md`, `src-tauri/src/lib.rs` (comandos registrados) y los módulos de `src-tauri/src/` y `src/features/`. Para cada ficha, flecha y escenario anota de dónde sale. No leas llaves, contraseñas ni `~/.tauri/`.
2. **Elegir nodos, zonas y escenarios.** Pocos y claros: lo que importa para entender, no cada archivo.
3. **Colocar** (ver «Geometría») y escribir el `spec`.
4. **Revisar con capturas** (ver «Revisión») hasta que se lea de un vistazo y nada se pise.
5. Enlazar el diagrama desde el documento de arquitectura y viceversa (`enlaces` del `spec`).

## Formato del `spec` (JSON)

El motor solo lee los campos de estas tablas. Cualquier otro se ignora, así que no inventes campos.

### Raíz

| Campo | Qué es |
|---|---|
| `titulo`, `subtitulo` | Encabezado de la página (el título también es el de la pestaña) |
| `enlaces` | Opcional. Lista de `{ "texto", "href" }` que se añaden al subtítulo |
| `descripcion` | Texto alternativo del dibujo (lectores de pantalla) |
| `lienzo` | `{ x, y, ancho, alto, minAncho }`: la caja del dibujo (`viewBox`) y el ancho mínimo en píxeles antes de que haya desplazamiento horizontal |
| `zonas` | Recuadros de límite (lista) |
| `nodos` | Fichas (objeto `id → nodo`) |
| `flechas` | Flechas (objeto `id → flecha`) |
| `pasos` | Opcional. Pasos reutilizables (objeto `id → paso`) |
| `estado` | Opcional. Máquina de estados por defecto de los escenarios |
| `escenarios` | Lista de recorridos (al menos uno) |
| `escenarioArquitectura` | Índice (desde 0) del escenario cuyos números y palabras se ven en la vista «Arquitectura». Por defecto 0 |
| `resumen` | Panel de la vista «Arquitectura» cuando no hay ficha elegida: `chip`, `titulo`, `simple`, `tech` (HTML o lista de HTML) y `pista` |

### Zona

`{ titulo, x, y, ancho, alto }`. El título va arriba a la izquierda. En lugar de `titulo`, `abajo: ["línea 1", "línea 2"]` pone el rótulo abajo, centrado. Las zonas pueden anidarse (computadora → contenedores → red). Se dibujan en el orden de la lista: las exteriores primero.

### Nodo

| Campo | Qué es |
|---|---|
| `x`, `y` | Centro del icono (60×60) |
| `ic` | Icono: `user people browser desktop server api db disk queue mail cloud gate chip cert panel file cv chat briefcase bookmark globe wrench download layers send flow steps lock`. Uno nuevo se añade en `ICONS` del motor |
| `k` | Tipo, que fija el color: `actor` (persona), `client` (navegador, programa del usuario), `server` (servicio o módulo), `data` (base de datos), `store` (archivos), `queue` (cola o trabajo en segundo plano), `ext` (servicio externo), `mem` (memoria o estado) |
| `n`, `tag` | Nombre (corto, ≤ 16 caracteres) y subtítulo (≤ 28) |
| `simple` | **En palabras simples**: una o dos frases para alguien que no es experto |
| `guarda` | **Qué guarda**: lista de textos cortos (`[]` si nada) |
| `tech` | **Detalle técnico**: HTML (`<p>`, `<code>`, `<b>`, `<ul>`) |
| `flag` | Marca de estado: `["dev", "En desarrollo"]`, `["prop", "Propuesto"]` o `["pend", "Pendiente"]` (el segundo valor es el texto) |
| `opt` | `true`: ficha atenuada con borde discontinuo (propuesta o pendiente) |

### Flecha

`{ a, b, pts, opt }`. `pts` es la lista de puntos `[x, y]` del recorrido; la punta queda en `b`. `opt: true` la dibuja discontinua. Entre dos nodos basta **una** flecha: se recorre en ambos sentidos, y los pasos la usan en el sentido que necesiten.

### Paso

| Campo | Qué es |
|---|---|
| `path` | Nodos que recorre el paquete, en orden. Entre cada par consecutivo **debe existir una flecha**. Un solo nodo = acción interna |
| `w` | Palabra corta de la acción (en la flecha y en el paquete) |
| `t` | Título del paso |
| `s` | Explicación en palabras simples |
| `d` | Detalle técnico (HTML): rutas, tablas, reglas |
| `rt` | Etiqueta de la respuesta: el paquete vuelve por el mismo camino |
| `set` | Insignias de estado por nodo: `{ "nodo": ["texto", "info\|ok\|warn\|err\|mut"] }`. Texto vacío la quita. Persisten en los pasos siguientes |
| `st` | Estado del objeto que sigue el escenario (clave de `estado.lista`) |
| `obs` | Lista de observaciones; se muestran hasta que otro paso las reemplace |
| `k` | Resultado del paso: `ok`, `warn` o `err` (colorea el paso y el nodo final) |
| `fail` | Fallo visible: `1` el paquete se pierde a mitad de la última flecha, `2` llega y es rechazado (marca ✕ en `bad` o en el último nodo) |
| `bad` | Nodo donde ocurre el fallo |
| `tag` | Chip extra en el panel del paso, por ejemplo `"Propuesto"` |
| `ne` | Id de la flecha donde se pone el número de orden (por omisión, la primera del camino). Útil cuando varios pasos caerían en la misma flecha o en un tronco compartido |
| `wl` | Lado de la palabra junto al número: `u`, `d`, `l`, `r` |

### Escenario

`{ n, c, ini, pasos, estado }`. `c` es el resultado general: `ok` (funciona), `warn` (queda por revisar o reintentar), `err` (se detiene) o `prop` (propuesto). `ini` es el paso (desde 0) que se ve al elegirlo. En `pasos` cada elemento puede ser un id de `pasos`, `{ "usa": "id", …campos que cambian }` o un paso completo con `path`.

### Estado

`{ titulo, lista, inicial, alt, publico, publicoTitulo }`. `lista` es `[["CLAVE", "Etiqueta"], …]` en orden; `alt` es el índice desde el que las etiquetas son alternativas (se separan con «/» en vez de «→»); `publico` (opcional) traduce cada clave a lo que ve la persona usuaria, con `publicoTitulo` como prefijo. Puede ir en la raíz o en cada escenario. Sin estado, esa fila no se muestra.

## Geometría

- **Ficha:** el icono ocupa `x±30, y±30`; el nombre va en `y+46`, el subtítulo en `y+60`, la insignia del recorrido en `y+68…84` y la marca de estado arriba a la derecha (`x+16, y-40`). Deja ≥ 180 de separación horizontal entre centros y ≥ 150 vertical, o los rótulos se pisan.
- **Flechas ortogonales** (horizontales y verticales). Salen a 32 del centro (borde del icono) y llegan a 32 antes del centro destino. Las verticales deben salir **debajo del subtítulo** (`y+66`) y terminar a `y-34` del destino; si no, atraviesan el rótulo.
- **Troncos compartidos:** varias flechas pueden empezar con el mismo tramo y bifurcarse (un bus). Para que dos flechas lleguen a la misma cara de una ficha sin superponerse, sepáralas ±12 en la coordenada transversal.
- **Pasillos:** pasa las flechas largas por huecos libres (entre filas o columnas), nunca por detrás de una ficha. Los cruces en ángulo recto son aceptables.
- **Números:** se ponen en el punto proporcional de la primera flecha de cada paso (o en `ne`). Si dos números se tocan, usa `ne`; si dos palabras se pisan, usa `wl`.
- **Zonas:** deja ≥ 20 entre el borde de una zona y las fichas, y que el rótulo de zona no se cruce con flechas ni con rótulos de otra zona anidada.
- **Tamaño:** a 1920 el dibujo ocupa unos 1280 px de ancho; a 1366, unos 990. Con un `lienzo` de ~1400 de ancho el texto sigue legible. Más ancho que eso obliga a desplazarse.

## Revisión con capturas

Desde la raíz del proyecto (usa Chrome sin interfaz, `google-chrome`):

```bash
node .claude/skills/diagrama-arquitectura/captura.mjs <url> <salida.png> [ancho] [alto] [light|dark]
```

Acepta `file://` y solo captura la ventana (usa un alto mayor para ver el recorrido completo). Parámetros de la página:

| Parámetro | Efecto |
|---|---|
| `?vista=arquitectura` o `?vista=recorrido` | Vista inicial |
| `?captura=1` | Una sola columna, sin controles ni animación: estado estático y determinista |
| `?escenario=N&paso=K` | Escenario y paso (desde 1) del recorrido |
| `?tema=claro` o `?tema=oscuro` | Tema (la captura también acepta `light`/`dark` por sistema) |

Revisa como mínimo: la vista de arquitectura a 1920×1080 y a 1366, en claro y en oscuro; un escenario con `?captura=1&vista=recorrido&escenario=N&paso=K` (mira un paso con fallo y uno con insignias); y el móvil a 390. Mira cada imagen y comprueba:

- que ningún número, palabra, flecha ni rótulo de zona se pise, ni tape el nombre de una ficha;
- que las flechas lleguen a la ficha correcta y con la punta visible;
- que el diagrama se lea de un vistazo y los textos sean legibles a 1366;
- que en el recorrido cada paso resalte el camino y la ficha que dice el texto;
- que en oscuro los colores sigan teniendo contraste (usa solo las variables de color de la plantilla).

Antes de dar por terminado, busca recursos externos: `grep -nE 'src=|<link|@import|url\(http' <archivo>` no debe devolver nada (la cadena `http://www.w3.org/2000/svg` del motor es un espacio de nombres, no una carga; y `href` solo se usa en `enlaces`, que es navegación).

## Reglas

1. **Un solo archivo.** HTML con estilos, motor y datos dentro.
2. **Sin recursos externos:** ni tipografías, ni scripts, ni imágenes, ni hojas de estilo remotas. Tipografía del sistema.
3. **Nada inventado.** Cada nodo, flecha, escenario y paso debe existir en el código o en la documentación (`ARQUITECTURA.md`, `PENDIENTES.md`, `MANUAL.md` o el CHANGELOG). Lo que aún no existe lleva la marca `Propuesto` (diseñado, sin código) o `Pendiente` (previsto), con la ficha y las flechas en `opt: true`, y el escenario en `c: "prop"`. Lo que se está construyendo lleva `En desarrollo`. Si un dato no se puede verificar, no se pone.
4. **Honesto con el estado.** Si el código cambió y el diagrama no, el diagrama miente: actualízalo al cerrar la fase que mueve piezas.
5. **Español simple.** `simple` y `s` sin jerga; la jerga va en `tech` y `d`. Sin secretos, claves ni datos personales.
6. **Las flechas son conexiones reales** (red, llamada, lectura o escritura). Si dos módulos solo se tocan a través de otro, la flecha pasa por ese otro.
