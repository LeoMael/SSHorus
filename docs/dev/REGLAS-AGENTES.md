# Reglas para construir SSHorus en paralelo

Proyecto: `/home/mael/LEO/Projects/SSHorus` — cliente SSH/SFTP de escritorio (estilo Termius/MobaXterm).
Tauri 2 + Rust (motor, `src-tauri/`) · React 19 + TypeScript + Vite (interfaz, `src/`).
Visión y diagramas: `docs/ARQUITECTURA.md` y `docs/arquitectura/*.png` (mira `04-ventana.png`).
El usuario habla español: **todo texto visible en la app va en español**. Calidad profesional.

## 1. Varios agentes trabajan A LA VEZ en la misma carpeta

- **Solo edita los archivos que tu tarea dice que son tuyos.** Puedes crear archivos nuevos dentro de tus carpetas.
- **Archivos BASE (no editar):**
  `src-tauri/src/{lib.rs,error.rs,types/,ssh/mod.rs}`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
  `src-tauri/capabilities/*`, `package.json`, `src/main.tsx`, `src/api/*`, `src/lib/*`, `src/styles/*.css`,
  `src/components/ui/*`, `src/stores/{tabs,settings,toasts,ui}.ts`.
  Si de verdad necesitas un cambio en BASE o una dependencia nueva: no lo hagas; arréglatelas y pídelo en tu informe final.
- Los **comandos Tauri ya están registrados** en `lib.rs` con su firma. Implementa el cuerpo; puedes quitar el `_` de
  los parámetros, pero **no cambies nombres de comandos, nombres/tipos de parámetros ni tipos de retorno**
  (la interfaz ya los llama así desde `src/api/*.ts`).
- Algunos archivos de otros agentes existen como STUB con su firma final (p. ej. `FileExplorer`, `TerminalArea`,
  `connectToServer`, `useProfiles`). Puedes importarlos; **respeta esas firmas en tus propios stubs**.
- Mientras compilas verás errores en archivos de otros agentes que están a medio trabajo: **ignóralos**, filtra la
  salida a tus archivos y nunca los "arregles". Si te bloquean por mucho rato, espera un poco y reintenta.

## 2. Compilar y probar

```bash
source ~/.cargo/env
cd src-tauri && cargo clippy --all-targets -- -D warnings                              # motor y sus pruebas (como la CI)
cd src-tauri && cargo test --lib TU_MODULO -- --ignored --test-threads=1              # tests con servidor real
npm run lint && npx tsc --noEmit                                                      # interfaz (0 errores y 0 warnings)
npm test                                                                              # pruebas de la interfaz (src/**/*.test.ts)
npm test -- TU_FILTRO                                                                 # solo las que tengan TU_FILTRO en la ruta
npm run check                                                                         # ESLint + ciclos + tope de líneas + pruebas (antes de tu informe)
```
- No empaquetes pruebas a mano con `npx rolldown … && node …`: usa `npm test` (borra sus archivos temporales).
- La CI ejecuta en Linux y en Windows `tsc`, ESLint (0 avisos), `vite build`, `cargo clippy --all-targets` y
  `cargo test --lib`, y solo en Linux `npm test` (varias pruebas ejecutan scripts de servidor con bash),
  `npm run check:deps` y `npm run check:lines` (ver §5). Clippy revisa también el código de pruebas: compruébalo
  con `--all-targets`, no solo con `--lib`.
- Esperar el candado de cargo ("Blocking waiting for file lock") es normal.
- **La máquina es justa (15 GB de RAM, disco casi lleno): no dejes nada abierto ni ocupando espacio.**
  - Compila siempre con `CARGO_BUILD_JOBS=3 CARGO_INCREMENTAL=0` y, si estás en un worktree,
    `CARGO_TARGET_DIR=/home/mael/LEO/Projects/SSHorus/src-tauri/target` (nunca otra carpeta `target/` propia).
  - Ejecuta clippy, tests y build **de uno en uno**, nunca a la vez ni varios en segundo plano.
  - Antes de tu informe final, cierra todo lo que abriste: procesos `cargo`/`rustc`/`node`/`vite` en segundo
    plano, el contenedor `terview-sshd` si lo arrancaste tú (`podman stop terview-sshd`), carpetas temporales y
    enlaces a `node_modules`. Comprueba con `pgrep -af 'cargo|rustc|vite'` que no queda nada tuyo.
  - Si el disco baja de ~10 GB libres, avisa en tu informe en vez de seguir compilando.
- **No** ejecutes `npm run tauri dev`, `tauri build`, `cargo build --release` ni abras ventanas.
- **Servidor SSH de pruebas**: `127.0.0.1:2222`, usuario `test`, contraseña `test123` (contenedor podman
  `terview-sshd`, OpenSSH 10.3, home `/config`, con `AllowTcpForwarding yes` para los túneles; cómo prepararlo
  en el README, «Pruebas»). Usa SOLO este servidor. Trabaja dentro de `/config/tmp-<algo>`
  y bórralo al final.
- En tests: `crate::ssh::connect::testutil::connect_test_server().await` devuelve un `Arc<SshSession>` listo
  (lo implementa el agente SSH primero; si aún da `unimplemented!`, sigue con otra cosa y reintenta luego).
- Tests que necesitan red: márcalos `#[ignore]` y `#[tokio::test]`.
- **Nunca** escribas en el `~/.ssh/known_hosts` real ni en el llavero real desde tests (usa rutas temporales y el
  servicio `sshorus-test`).

## 3. Motor (Rust)

- Versiones: `russh 0.65.1`, `russh-sftp 3.0.1`, `tauri 2.12`, `tokio` (full), `tokio-util`, `futures`, `walkdir`,
  `uuid` (v4), `keyring 4.2`, `dirs 7`, `thiserror 2`, `serde/serde_json`, `log`.
  Código fuente y ejemplos: `~/.cargo/registry/src/index.crates.io-*/<crate>-<versión>/` (mira `examples/`).
  El trait `russh::client::Handler` usa `async fn` nativo (sin `async_trait`).
- Errores: devuelve `AppResult<T>` y usa las variantes de `AppError` (`src-tauri/src/error.rs`) con mensajes en español.
  Ya existen `From` para `io::Error`, `russh::Error`, `russh_sftp::client::error::Error`, `serde_json::Error`.
- Tipos compartidos en `src-tauri/src/types/` (por temas, re-exportados en `types/mod.rs`: se usan como
  `crate::types::X`; espejo de `src/api/types.ts`). Eventos: constantes `EV_*`.
- Sin `unwrap()`/`expect()` en rutas de ejecución normales. Nada de bloquear el runtime async
  (usa `tokio::task::spawn_blocking` para E/S de disco pesada si hace falta).

## 4. Interfaz (React)

- Llama al motor SOLO por `src/api/*`: hay un archivo por módulo del motor (`ssh.ts`, `terminal.ts`, `sftp.ts`,
  `transfers.ts`, `profiles.ts`, `mcp.ts`, `vulnscan.ts`, `audit.ts`…), más `core.ts` (llamada y errores),
  `types.ts` (espejo de `src-tauri/src/types/`) e `index.ts`.
  Los errores llegan como `ApiError` con `.kind` (ver `isApiError`).
- Estado: `zustand`. Compartidos: `useTabs` (pestañas), `useSettings` (ajustes), `toast` (avisos), `useUi` (diálogos globales).
- Diálogos: `confirmDialog()` / `promptDialog()` (`src/components/ui/dialogs.tsx`), `Modal`.
- Utilidades: `src/lib/format.ts` (bytes, fechas, velocidad), `src/lib/paths.ts` (rutas remotas).
- Íconos: `lucide-react`. Paneles redimensionables: `react-resizable-panels` v4 (lee sus tipos en node_modules; la API cambió respecto a v2).
  Diálogos de archivos locales: `@tauri-apps/plugin-dialog`. Arrastrar desde el sistema: `getCurrentWebview().onDragDropEvent`.
- Estilos: **usa las variables y clases del tema (`src/styles/`: variables en `theme.css`, clases en `controls.css`,
  `overlays.css` y `utilities.css`)** (`--bg`, `--surface`, `--accent`, `.btn`, `.btn-primary`,
  `.input`, `.field`, `.icon-btn`, `.context-menu`, `.progress`, `.status-dot`, `.section-label`, `.empty-state`, `.spinner`…).
  Tu CSS va en un archivo junto a tu componente, importado desde él, con clases prefijadas por el componente
  (p. ej. `.fx-row` para FileExplorer) para no chocar con otros. Debe verse bien en tema oscuro y claro.
- Densidad tipo herramienta profesional (VS Code / Termius): filas de ~28 px, fuente 13 px, sin espacios enormes.
- Accesible por teclado donde tenga sentido. Nada de `any` salvo que sea inevitable.

## 5. Calidad del código (pedido del usuario: nada de código ni archivos espagueti)

- **Las reglas de orden se comprueban solas** (`npm run check` en local; la CI falla si se rompen): límites entre
  carpetas (ESLint), ciclos entre carpetas (`npm run check:deps`) y tope de 500 líneas (`npm run check:lines`).
  El detalle está en `docs/ARQUITECTURA.md` §5. Lo que ya las incumplía está en `EXCEPCIONES_LIMITES`
  (`eslint.config.js`), `scripts/deps-allowlist.json` y `scripts/lines-allowlist.json`. **Esas listas solo
  pueden encoger**: nunca añadas una excepción para que pase la CI (mueve o parte el código); si arreglas algo
  de la lista, borra su línea (los scripts avisan).
- **Archivos pequeños y con un solo tema**: apunta a < 300 líneas (máx. ~400; 500 es el tope que mira la CI,
  también en CSS y Rust). Si un archivo ya pasa de ~400 líneas, **no le añadas lógica**: crea un componente,
  hook o módulo nuevo y engánchalo con lo mínimo.
- **Una responsabilidad por función/componente**. La lógica pura (cálculos, análisis de salidas de comandos,
  reglas) va aparte de la interfaz y de los comandos Tauri, y lleva pruebas.
- **Datos en vez de `if` repetidos**: si hay varias variantes (asistentes, tipos de llave, modos), descríbelas en
  una tabla y recórrela.
- **Organización de carpetas** (la regla completa de dónde va cada archivo está en `docs/ARQUITECTURA.md` §5,
  «Dónde va cada archivo»): `components/<X>/` = interfaz React de un dominio; `features/<x>/` = lógica sin React y
  stores de esa función; `components/ui/` = controles genéricos de más de un dominio; `stores/` = estado de toda
  la app; `lib/` = utilidades puras sin dominio (`lib/remote/` para scripts remotos); ejecutar con elevación:
  `features/privileges/run.ts`.
  - No dejes archivos sueltos en la raíz de `src/features/`: cada dominio tiene su carpeta (`src/features/<dominio>/`).
  - Ningún componente ni feature llama directamente a `invoke()` de Tauri: todo pasa por `src/api/*` (ESLint lo
    impide).
  - **Comandos Tauri (Rust), criterio fijo:** cada módulo con comandos tiene su `commands.rs` (si son muchos, la
    carpeta `commands/` con un archivo por tema, como `storage/commands/`) y ahí van **todos** sus
    `#[tauri::command]`, solo como envoltorios finos: validar la entrada, sacar el estado (`State`, `AppHandle`),
    llamar a la lógica y convertir el error. La lógica va en otros archivos del módulo, sin Tauri, y lleva pruebas.
    `lib.rs` registra cada comando como `modulo::commands::nombre` (sin `pub use commands::*`). Un módulo de un solo
    archivo que gana comandos pasa a carpeta (`localfs/{mod.rs,commands.rs}`). El nombre de la función es el del
    comando: no lo cambies. Detalle en `docs/ARQUITECTURA.md` §5.
- **Sin duplicar**: antes de escribir algo, busca si ya existe (diálogos, selectores, llamadas a sudo) y reutilízalo.
- Nombres claros, sin código muerto ni comentarios que repiten el código; comentarios solo para el «por qué».
- Mantén `npm run check` y `cargo clippy --all-targets -- -D warnings` siempre en verde.
- **Antes de cada versión** (esto no lo mira la CI): `/code-review` del lote y anotar en el CHANGELOG lo que se arregló.

## 6. Informe final (máx. ~300 palabras)

Qué hiciste, archivos, cómo lo probaste (y resultado), límites conocidos, y peticiones de cambios a BASE o dependencias.
