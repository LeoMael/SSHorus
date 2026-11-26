// Captura una pantalla de la aplicación con Chrome sin interfaz, emulando tamaño y tema.
// Uso: node scripts/captura.mjs <url> <salida.png> [ancho=1920] [alto=1080] [light|dark] [arriba|actual]
//   «arriba» (por defecto) captura desde el principio de la página; «actual», donde la página se haya situado.
// Imprime además medidas útiles para detectar desbordes y espacio desaprovechado.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [url, out, width = '1920', height = '1080', scheme = 'light', position = 'arriba'] =
  process.argv.slice(2);
if (!url || !out) {
  console.error(
    'Uso: node scripts/captura.mjs <url> <salida.png> [ancho] [alto] [light|dark] [arriba|actual]',
  );
  process.exit(2);
}

const port = 9300 + Math.floor(Math.random() * 600);
const profile = mkdtempSync(path.join(tmpdir(), 'sshorus-captura-'));
const chrome = spawn(
  process.env.CHROME_PATH ?? 'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let target;
for (let attempt = 0; attempt < 50 && !target; attempt++) {
  await sleep(200);
  try {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    target = pages.find((page) => page.type === 'page');
  } catch {
    // Chrome todavía no escucha: se reintenta.
  }
}
if (!target) {
  chrome.kill('SIGKILL');
  console.error('No se pudo conectar con Chrome.');
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener('open', resolve));
let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data.result ?? data.error);
    pending.delete(data.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    nextId += 1;
    pending.set(nextId, resolve);
    socket.send(JSON.stringify({ id: nextId, method, params }));
  });

await send('Emulation.setDeviceMetricsOverride', {
  width: Number(width),
  height: Number(height),
  deviceScaleFactor: 1,
  mobile: Number(width) < 700,
});
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(Number(process.env.CAPTURA_ESPERA_MS ?? 5000));

const measure = `JSON.stringify({
  ventana: [window.innerWidth, window.innerHeight],
  documento: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
  desplazamiento: Math.round(window.scrollY),
  desbordeHorizontal: document.documentElement.scrollWidth > window.innerWidth,
  principal: (() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const box = main.getBoundingClientRect();
    return { izquierda: Math.round(box.left), ancho: Math.round(box.width) };
  })(),
})`;
const measured = await send('Runtime.evaluate', { expression: measure, returnByValue: true });
console.log(measured.result?.value);

if (position === 'arriba') {
  await send('Runtime.evaluate', { expression: 'window.scrollTo(0, 0)' });
  await sleep(400);
}
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));

socket.close();
chrome.kill('SIGKILL');
rmSync(profile, { recursive: true, force: true });
process.exit(0);
