// Measures the page on ANGLE's Direct3D 11 backend (Chrome and Edge on Windows) from WSL: Windows Chrome,
// headless, with a profile of its own in the Windows temporary directory. The page reports to the local server
// over HTTP (Windows reaches WSL's localhost); no DevTools connection is needed. One Chrome at a time; each run
// kills exactly its own processes (by its profile's path, never by name: the owner's Chrome may be running) and
// deletes its profile.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { startServer, sleep } from './browser.mjs';

const CHROME = process.env.SKY_WIN_CHROME || '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
// Windows programs want a Windows working directory.
const win = (file, args) => execFileSync(file, args, { encoding: 'utf8', cwd: '/mnt/c', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r/g, '');
const winTemp = () => {
  const t = win('cmd.exe', ['/c', 'echo %TEMP%']).trim();
  return { win: t, wsl: win('wslpath', ['-u', t]).trim() };
};

// Script put first in the page's <head>: posts its console lines, the renderer, the GPU time of each animation
// frame once the first picture shows (EXT_disjoint_timer_query_webgl2 around the frame's callback), then `done`.
const INJECT = `<script>(() => {
  const q = new URLSearchParams(location.search), run = q.get('d3d'), FRAMES = +(q.get('d3dFrames') || 60);
  const post = o => fetch('/d3d/report/' + run, { method: 'POST', body: JSON.stringify(Object.assign({ at: performance.now() / 1000 }, o)) }).catch(() => {});
  for (const k of ['info', 'log', 'warn', 'error']) {
    const f = console[k];
    console[k] = (...a) => { post({ ev: 'console', msg: a.map(String).join(' ').slice(0, 500) }); f.apply(console, a); };
  }
  let gl = null, ext = null, started = false, done = false;
  const times = [], pending = [];
  const get = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    const c = get.call(this, t, o);
    if (t === 'webgl2' && c && !gl) {
      gl = c;
      ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      post({ ev: 'renderer', renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) });
      this.addEventListener('webglcontextlost', () => post({ ev: 'console', msg: 'webglcontextlost' }));
    }
    return c;
  };
  const finish = o => { done = true; post(o).then(() => post({ ev: 'done' })); };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(ts => {
    let query = null;
    if (ext && started && !done && !gl.isContextLost()) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    try { cb(ts); } finally {
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const p = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p);
      }
      if (!done && times.length >= FRAMES + 10) {
        const s = times.slice(10).sort((a, b) => a - b);
        finish({ ev: 'frames', median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], w: gl.drawingBufferWidth, h: gl.drawingBufferHeight });
      }
    }
  });
  const watch = setInterval(() => {
    const hero = document.querySelector('.hero');
    if (!hero || started) return;
    if (hero.classList.contains('shown') || hero.classList.contains('failed')) {
      started = true;
      clearInterval(watch);
      post({ ev: 'shown', failed: hero.classList.contains('failed') });
      if (!ext || hero.classList.contains('failed')) finish({ ev: 'frames' });
    }
  }, 20);
})();</script>`;

// The harness page of \`programs\`: compiles each program of the page alone (as makeSky links it), polling
// KHR_parallel_shader_compile, then draws it into a 4 x 4 framebuffer once with one target and once with all its
// outputs (ANGLE on Direct3D 11 compiles a program again for a draw into more than one target, while the GPU
// process waits). Each draw is timed by a read of a pixel after it.
const PROGRAMS = `<!doctype html><meta charset="utf-8"><canvas width="4" height="4"></canvas><script>(async () => {
  const run = new URLSearchParams(location.search).get('d3d');
  const post = o => fetch('/d3d/report/' + run, { method: 'POST', body: JSON.stringify(o) });
  const gl = document.querySelector('canvas').getContext('webgl2');
  const info = gl.getExtension('WEBGL_debug_renderer_info'), par = gl.getExtension('KHR_parallel_shader_compile');
  await post({ ev: 'renderer', renderer: gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) });
  const programs = await (await fetch('/d3d/programs.json')).json();
  const VS = '#version 300 es\\nlayout(location = 0) in vec2 p;\\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }';
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const probe = gl.createFramebuffer(), px = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, probe);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
  const wait = () => {
    const t = performance.now();
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, probe);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return Math.round(performance.now() - t);
  };
  const SAMPLERS = [gl.SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_CUBE, gl.INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_2D, gl.INT_SAMPLER_3D, gl.UNSIGNED_INT_SAMPLER_3D];
  const FORMATS = { vec4: gl.RGBA8, uvec4: gl.RGBA32UI, ivec4: gl.RGBA32I };
  for (const { name, source, outputs } of programs) {
    const t0 = performance.now(), prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, source]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    gl.flush();
    while (par && !gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) await new Promise(r => setTimeout(r, 10));
    const r = { ev: 'program', name, link: Math.round(performance.now() - t0) };
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { await post({ ...r, error: gl.getProgramInfoLog(prog) }); continue; }
    gl.useProgram(prog);
    for (let i = 0, unit = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) {
      const u = gl.getActiveUniform(prog, i);
      if (SAMPLERS.includes(u.type)) gl.uniform1i(gl.getUniformLocation(prog, u.name), unit++);
    }
    const active = outputs.filter(o => gl.getFragDataLocation(prog, o.name) >= 0);
    const frame = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    for (const o of active) {
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texStorage2D(gl.TEXTURE_2D, 1, FORMATS[o.type], 4, 4);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + o.location, gl.TEXTURE_2D, gl.getParameter(gl.TEXTURE_BINDING_2D), 0);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.viewport(0, 0, 4, 4);
    const all = [];
    for (let i = 0; i <= Math.max(0, ...active.map(o => o.location)); i++) all.push(active.some(o => o.location === i) ? gl.COLOR_ATTACHMENT0 + i : gl.NONE);
    gl.drawBuffers(all.map((b, i) => i === 0 ? b : gl.NONE));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    r.draw = wait();
    if (active.length > 1) {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, frame);
      gl.drawBuffers(all);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      r.targets = active.length;
      r.drawAll = wait();
    }
    r.error = gl.getError() || undefined;
    await post(r);
  }
  await post({ ev: 'done' });
})().catch(e => fetch('/d3d/report/' + new URLSearchParams(location.search).get('d3d'), { method: 'POST', body: JSON.stringify({ ev: 'done', error: String(e) }) }));</script>`;

// The programs makeSky links (its link('id'[, '#define X']) calls), with the outputs each declares.
function programsOf(html) {
  const shaders = {};
  for (const m of html.matchAll(/<script id="(\w+)" type="x-shader\/x-fragment">([\s\S]*?)<\/script>/g)) shaders[m[1]] = m[2].trim();
  const seen = new Set(), list = [];
  for (const m of html.matchAll(/link\('(\w+)'(?:, '#define (\w+)')?\)/g)) {
    const key = m[1] + (m[2] ? ' (' + m[2] + ')' : '');
    if (seen.has(key) || !shaders[m[1]]) continue;
    seen.add(key);
    const source = m[2] ? shaders[m[1]].replace('#version 300 es', '#version 300 es\n#define ' + m[2]) : shaders[m[1]];
    const outputs = [...source.matchAll(/^\s*(?:layout\(location = (\d+)\)\s*)?out\s+(\w+)\s+(\w+);/gm)]
      .map(o => ({ location: +(o[1] || 0), type: o[2], name: o[3] }));
    list.push({ name: key, source, outputs });
  }
  return list;
}

// The Chrome processes started with a profile (by its path on their command line).
const processesOf = (prof) => win('powershell.exe', ['-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${prof}*' } | ForEach-Object { $_.ProcessId }`])
  .split('\n').map((s) => s.trim()).filter(Boolean);
const kill = (pids) => {
  for (const pid of pids) { try { win('taskkill.exe', ['/PID', pid, '/T', '/F']); } catch {} }
};
// The run going on, for the exit handler: an interrupted run kills its Chrome too.
let current = null;
process.on('exit', () => {
  if (!current) return;
  try { kill(processesOf(current.prof)); fs.rmSync(current.dir, { recursive: true, force: true }); } catch {}
});

// One headless Windows Chrome on Direct3D 11 at url, until the page reports `done` or `limit` s pass.
async function runChrome(url, reports, id, { limit, size }) {
  const temp = winTemp(), prof = `sky-d3d-${process.pid}-${id}`;
  fs.mkdirSync(path.join(temp.wsl, prof));
  current = { prof, dir: path.join(temp.wsl, prof) };
  const child = spawn(CHROME, ['--headless=new', '--use-angle=d3d11', `--user-data-dir=${temp.win}\\${prof}`,
    '--disable-gpu-shader-disk-cache', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--window-size=${size.w},${size.h}`, url], { cwd: '/mnt/c', stdio: 'ignore' });
  child.on('error', (e) => reports.push({ ev: 'done', error: String(e) }));
  const t0 = Date.now();
  while (Date.now() - t0 < limit * 1000 && !reports.some((r) => r.ev === 'done')) await sleep(250);
  const timedOut = !reports.some((r) => r.ev === 'done');
  for (let i = 0; i < 10; i++) {
    const pids = processesOf(prof);
    if (!pids.length) break;
    kill(pids);
    await sleep(1000);
  }
  child.kill();
  for (let i = 0; i < 10; i++) {
    try { fs.rmSync(path.join(temp.wsl, prof), { recursive: true, force: true }); break; } catch { await sleep(1000); }
  }
  const left = processesOf(prof);
  if (left.length) throw new Error(`d3d: Chrome processes of ${prof} left: ${left.join(' ')}`);
  current = null;
  return timedOut;
}

// `node tools/sky.mjs d3d [page|programs] ...`: see tools/README.md.
export async function d3d(pages, { mode = 'page', q = '', runs = 1, limit = 300, frames = 60, size = { w: 1920, h: 1080 } }) {
  if (!fs.existsSync(CHROME)) throw new Error(`d3d: no Windows Chrome at ${CHROME} (SKY_WIN_CHROME)`);
  const reports = new Map();
  const files = new Map();
  const server = await startServer({
    handle(req, res, url) {
      const m = /^\/d3d\/(report\/(\w+)|page\/(\w+)\/index\.html|programs\/(\w+)\.(json|html))$/.exec(url.pathname);
      if (!m) return false;
      if (m[2] && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          try { reports.get(m[2])?.push(JSON.parse(body)); } catch {}
          res.writeHead(200);
          res.end();
        });
        return true;
      }
      const text = files.get(url.pathname);
      if (text === undefined) return false;
      res.writeHead(200, { 'content-type': url.pathname.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(text);
      return true;
    },
  });
  const port = new URL(server.url('.')).port;
  const results = [];
  try {
    for (let r = 0; r < runs; r++) {
      for (const [p, page] of pages.entries()) {
        const id = `${r}x${p}`, html = fs.readFileSync(path.join(page.dir, 'index.html'), 'utf8');
        let url;
        if (mode === 'programs') {
          files.set(`/d3d/programs/${id}.html`, PROGRAMS.replace("fetch('/d3d/programs.json')", `fetch('/d3d/programs/${id}.json')`));
          files.set(`/d3d/programs/${id}.json`, JSON.stringify(programsOf(html)));
          url = `http://localhost:${port}/d3d/programs/${id}.html?d3d=${id}`;
        } else {
          files.set(`/d3d/page/${id}/index.html`, html.replace('<head>', '<head>\n' + INJECT));
          url = `http://localhost:${port}/d3d/page/${id}/index.html?timing&res=1${q ? '&' + q : ''}&d3d=${id}&d3dFrames=${frames}`;
        }
        reports.set(id, []);
        const timedOut = await runChrome(url, reports.get(id), id, { limit, size });
        const got = reports.get(id);
        results.push({ page: page.name, run: r + 1, timedOut, got });
        print(page.name, r + 1, mode, got, timedOut, limit);
      }
    }
  } finally {
    server.close();
  }
  return results;
}

function print(name, run, mode, got, timedOut, limit) {
  const renderer = got.find((g) => g.ev === 'renderer')?.renderer || '(no context)';
  console.log(`${name}, run ${run}: ${renderer}${timedOut ? `, stopped after ${limit} s` : ''}`);
  if (mode === 'programs') {
    for (const g of got.filter((g) => g.ev === 'program')) {
      console.log(`  ${g.name.padEnd(20)} link ${String(g.link).padStart(7)} ms, first draw ${g.draw ?? '-'} ms` +
        (g.targets ? `, draw into ${g.targets} targets ${g.drawAll} ms` : '') + (g.error ? `, error ${g.error}` : ''));
    }
    return;
  }
  for (const g of got.filter((g) => g.ev === 'console')) console.log(`  ${g.msg}`);
  const shown = got.find((g) => g.ev === 'shown');
  if (shown) console.log(`  ${shown.failed ? 'failed' : 'first picture'} at ${shown.at.toFixed(2)} s (since the navigation)`);
  const f = got.find((g) => g.ev === 'frames');
  if (f?.median) console.log(`  GPU time per frame at ${f.w} x ${f.h}: median ${f.median.toFixed(2)} ms, p90 ${f.p90.toFixed(2)} ms`);
}
