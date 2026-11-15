// Finds and starts headless Chrome, talks to it over the DevTools protocol (Node's own WebSocket), and serves page
// directories over HTTP. The one place that knows Chrome's flags.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const which = (name) => {
  for (const dir of (process.env.PATH || '').split(':')) {
    const f = path.join(dir, name);
    try { fs.accessSync(f, fs.constants.X_OK); return f; } catch {}
  }
  return null;
};

// SKY_CHROME, else the newest Chromium of Playwright's cache, else a Chrome on PATH.
export function findChrome() {
  if (process.env.SKY_CHROME) return process.env.SKY_CHROME;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  let dirs = [];
  try { dirs = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)); } catch {}
  dirs.sort((a, b) => +b.split('-')[1] - +a.split('-')[1]);
  for (const d of dirs) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const f = path.join(cache, d, sub);
      if (fs.existsSync(f)) return f;
    }
  }
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const f = which(n);
    if (f) return f;
  }
  throw new Error('No Chrome found: set SKY_CHROME, or install one (npx playwright install chromium).');
}

// The renderers. SwiftShader (the default) runs on the CPU anywhere and gives the same pixels on every run.
// SKY_GPU=1 asks for the GPU. On WSL2 (found by /dev/dxg), Mesa reaches the GPU through D3D12 only with
// GALLIUM_DRIVER=d3d12 (else it falls back to llvmpipe, on the CPU); the adapter is picked by name
// (SKY_GPU_ADAPTER, default NVIDIA). These flags were found on the owner's machine (WSL2, RTX 3090) in November 2026.
export function renderer() {
  const want = process.env.SKY_GPU && process.env.SKY_GPU !== '0';
  if (!want) return { name: 'swiftshader', flags: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle'], env: {} };
  const wsl = fs.existsSync('/dev/dxg');
  return {
    name: wsl ? 'gpu-wsl' : 'gpu',
    flags: ['--use-angle=gl-egl', '--ignore-gpu-blocklist'],
    env: wsl ? { GALLIUM_DRIVER: 'd3d12', MESA_D3D12_DEFAULT_ADAPTER_NAME: process.env.SKY_GPU_ADAPTER || 'NVIDIA' } : {},
  };
}

// A static server for page directories: one port, each directory under its own prefix (/0/, /1/, ...), so that a
// page and its base can be served together. Caching is off, so every load reads the files on disk.
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.glsl': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
};
export async function startServer() {
  const roots = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = /^\/(\d+)(\/.*)$/.exec(decodeURIComponent(url.pathname));
    const root = m && roots[+m[1]];
    let file = root && path.join(root, m[2]);
    if (file && !(file + path.sep).startsWith(root + path.sep) && file !== root) file = null;
    if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file || !fs.existsSync(file)) {
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    // The URL of a directory's index.html.
    url(root) {
      root = path.resolve(root);
      let i = roots.indexOf(root);
      if (i < 0) i = roots.push(root) - 1;
      return `http://127.0.0.1:${port}/${i}/index.html`;
    },
    close: () => server.close(),
  };
}

// Starts Chrome with a fresh profile in a short temporary directory (Chrome puts sockets there; a long path makes
// it fail at start). Chrome dies with this process: it gets SIGKILL from the kernel when its parent dies
// (setpriv --pdeathsig), and close() kills its whole process group on exit, on a signal or on an error.
// The short temporary directory for profiles and base copies.
export const shortTmp = () => (os.tmpdir().length <= 24 ? os.tmpdir() : '/tmp');

// Removes profiles and base copies of this user older than a day: a run killed with SIGKILL leaves its own.
export function cleanStale() {
  const tmp = shortTmp(), day = Date.now() - 864e5;
  let names = [];
  try { names = fs.readdirSync(tmp); } catch {}
  for (const n of names) {
    if (!/^sky-(base-)?[A-Za-z0-9]{6}$/.test(n)) continue;
    const f = path.join(tmp, n);
    try {
      const st = fs.lstatSync(f);
      if (st.isDirectory() && st.uid === process.getuid() && st.mtimeMs < day) fs.rmSync(f, { recursive: true, force: true });
    } catch {}
  }
}

export async function launchChrome() {
  const chrome = findChrome();
  const r = renderer();
  cleanStale();
  const tmp = shortTmp();
  const profile = fs.mkdtempSync(path.join(tmp, 'sky-'));
  const args = ['--headless=new', ...r.flags, '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--hide-scrollbars', '--window-size=1400,900', '--lang=en-US', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'];
  // The language of the page follows the browser's: pinned, like the time zone (see page.mjs).
  const env = { ...process.env, ...r.env, TMPDIR: profile, LANG: 'en_US.UTF-8', LANGUAGE: 'en_US' };
  if (process.env.SKY_CHROME_LIBS) env.LD_LIBRARY_PATH = [process.env.SKY_CHROME_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  delete env.DISPLAY; // headless must not touch a desktop; with DISPLAY set, headless Chrome on WSLg got no WebGL2
  delete env.WAYLAND_DISPLAY;
  const setpriv = process.platform === 'linux' && which('setpriv');
  const [cmd, cmdArgs] = setpriv ? [setpriv, ['--pdeathsig', 'KILL', chrome, ...args]] : [chrome, args];
  const proc = spawn(cmd, cmdArgs, { detached: true, stdio: ['ignore', 'ignore', 'pipe'], env });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20000); });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try { process.kill(-proc.pid, 'SIGKILL'); } catch {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', close);
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile) && proc.exitCode === null; i++) await sleep(100);
  if (!fs.existsSync(portFile)) {
    close();
    const hint = /shared libraries/.test(stderr) ? '\nChrome lacks libraries: point SKY_CHROME_LIBS at them (tools/README.md).' : '';
    throw new Error(`Chrome did not start (${chrome}):\n${stderr.slice(-1500)}${hint}`);
  }
  const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);
  let id = 0;
  const pending = new Map();
  const handlers = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject, method } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`));
      else resolve(m.result);
    } else if (m.method) for (const h of handlers) h(m);
  };
  // Once Chrome is gone (its process ended, or the connection closed), every call waiting and every later call
  // fails at once, instead of waiting for the time limit.
  let dead = null;
  const die = (why) => {
    if (dead) return;
    dead = new Error(`Chrome went away (${why})${stderr ? ':\n' + stderr.slice(-800) : ''}`);
    for (const { reject } of pending.values()) reject(dead);
    pending.clear();
    for (const h of handlers) h({ method: 'sky.chromeDied' });
  };
  ws.onclose = () => die('the DevTools connection closed');
  proc.on('exit', (code, sig) => die(`its process ended, ${sig || 'status ' + code}`));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP connection failed')); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (dead) return reject(dead);
    if (ws.readyState !== WebSocket.OPEN) { die('the DevTools connection is not open'); return reject(dead); }
    const i = ++id;
    pending.set(i, { resolve, reject, method });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const version = await send('Browser.getVersion');
  return {
    renderer: r.name, chrome, version: version.product,
    send, on: (h) => handlers.add(h), off: (h) => handlers.delete(h), stderr: () => stderr, dead: () => dead,
    close() { try { ws.close(); } catch {} close(); },
  };
}
