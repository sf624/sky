// Measures the page on ANGLE's Direct3D 11 backend (Chrome and Edge on Windows) from WSL: Windows Chrome,
// headless, with a profile of its own in the Windows temporary directory. The page reports to the local server
// over HTTP (Windows reaches WSL's localhost); no DevTools connection is needed. One Chrome at a time; each run
// kills exactly its own processes (by its profile's path, never by name: the owner's Chrome may be running) and
// deletes its profile.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { startServer, sleep, withQuality } from './browser.mjs';

const CHROME = process.env.SKY_WIN_CHROME || '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';
// Windows programs want a Windows working directory.
const win = (file, args) => execFileSync(file, args, { encoding: 'utf8', cwd: '/mnt/c', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r/g, '');
const winTemp = () => {
  const t = win('cmd.exe', ['/c', 'echo %TEMP%']).trim();
  return { win: t, wsl: win('wslpath', ['-u', t]).trim() };
};

// Script put first in the page's <head>: posts its console lines, the renderer, the GPU time of each animation
// frame once the first picture shows (EXT_disjoint_timer_query_webgl2 around the frame's callback), then `done`.
// With d3dShot=S, it posts instead the canvas as a PNG S s after the first picture, then `done`.
// With d3dSteps=V@S,... it sets the Clouds slider to V at S s after the first picture, each in turn, and posts
// instead the gaps between animation frames from the first step on, for d3dWatch s, then `done`.
const INJECT = `<script>(() => {
  const q = new URLSearchParams(location.search), run = q.get('d3d'), FRAMES = +(q.get('d3dFrames') || 60), SHOT = +(q.get('d3dShot') || 0);
  const STEPS = (q.get('d3dSteps') || '').split(',').filter(Boolean).map(s => s.split('@').map(Number)), WATCH = +(q.get('d3dWatch') || 30);
  let stepped = null, last = null;
  const gaps = [];
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
    const t = performance.now();
    if (stepped !== null && last !== null) gaps.push([t - last, (last - stepped) / 1000]);
    last = t;
    let query = null;
    if (ext && started && !done && !gl.isContextLost()) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    try { cb(ts); } finally {
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const p = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p);
      }
      if (!done && !SHOT && !STEPS.length && times.length >= FRAMES + 10) {
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
      if (SHOT) setTimeout(() => finish({ ev: 'shot', png: document.getElementById('sky').toDataURL('image/png') }), SHOT * 1000);
      else if (STEPS.length) {
        const slider = document.getElementById('cloud');
        for (const [v, s] of STEPS) setTimeout(() => {
          if (stepped === null) stepped = performance.now();
          slider.value = v;
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          post({ ev: 'console', msg: 'd3d: slider at ' + v });
        }, s * 1000);
        setTimeout(() => {
          const g = gaps.slice().sort((a, b) => b[0] - a[0]);
          const gpu = times.slice().sort((a, b) => a - b);
          const bins = [];
          for (const [ms, at] of gaps) {
            const b = Math.floor(at / 2);
            bins[b] = bins[b] || [0, 0];
            if (ms > 50) bins[b][0]++;
            bins[b][1] = Math.max(bins[b][1], ms);
          }
          finish({ ev: 'gaps', n: gaps.length, worst: g.slice(0, 5), bins: [...bins].map(b => b || [0, 0]), over50: gaps.filter(x => x[0] > 50).length, over100: gaps.filter(x => x[0] > 100).length,
            median: gaps.map(x => x[0]).sort((a, b) => a - b)[gaps.length >> 1], gpuMedian: gpu[gpu.length >> 1], gpuMax: gpu[gpu.length - 1] });
        }, (STEPS[0][1] + WATCH) * 1000);
      }
      else if (!ext || hero.classList.contains('failed')) finish({ ev: 'frames' });
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

// The programs makeSky links (its link('id'[, [D +] '#define X']) calls), with the outputs each declares; and
// where fs has the overcast's deck (#ifdef DECK), its programs with the deck too (made later by the page, see
// deckLater in index.html), named as the page names them.
function programsOf(html) {
  const shaders = {};
  for (const m of html.matchAll(/<script id="(\w+)" type="x-shader\/x-fragment">([\s\S]*?)<\/script>/g)) shaders[m[1]] = m[2].trim();
  const seen = new Set(), list = [];
  const calls = [...html.matchAll(/link\('(\w+)'(?:, (?:D \+ )?'#define (\w+)'|, D)?\)/g)].map((m) => [m[1], m[2] ? [m[2]] : []]);
  if (/^#ifdef DECK$/m.test(shaders.fs || '')) for (const d of [[], ['CLOUD_PASS'], ['SHADOW_MAP'], ['TOPS_MAP']]) calls.push(['fs', ['DECK', ...d]]);
  for (const [id, defs] of calls) {
    const key = id + (defs.length ? ' (' + defs.join(' ') + ')' : '');
    if (seen.has(key) || !shaders[id]) continue;
    seen.add(key);
    const source = defs.length ? shaders[id].replace('#version 300 es', '#version 300 es\n' + defs.map((d) => '#define ' + d).join('\n')) : shaders[id];
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
export async function d3d(pages, { mode = 'page', q = '', runs = 1, limit = 300, frames = 60, size = { w: 1920, h: 1080 }, shot = 0, out = null, steps = '', watch = 30 }) {
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
          // (A picture is taken at the page's own drawing size: no res=1.)
          url = `http://localhost:${port}/d3d/page/${id}/index.html?timing${shot ? '' : '&res=1'}&${withQuality(q)}&d3d=${id}` +
            (shot ? `&d3dShot=${shot}` : `&d3dFrames=${frames}`) + (steps ? `&d3dSteps=${steps}&d3dWatch=${watch}` : '');
        }
        reports.set(id, []);
        const timedOut = await runChrome(url, reports.get(id), id, { limit, size });
        const got = reports.get(id);
        results.push({ page: page.name, run: r + 1, timedOut, got });
        print(page.name, r + 1, mode, got, timedOut, limit);
        const png = got.find((g) => g.ev === 'shot')?.png;
        if (png && out) {
          const file = path.resolve(`${out}-${page.name.replace(/\W+/g, '_')}-${r + 1}.png`);
          fs.writeFileSync(file, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
          console.log(`  shot: ${file}`);
        }
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
  const gp = got.find((g) => g.ev === 'gaps');
  if (gp) console.log(`  frames from the first step on: ${gp.n}, median gap ${gp.median?.toFixed(1)} ms, over 50 ms ${gp.over50}, over 100 ms ${gp.over100}; ` +
    `longest ${gp.worst.map(([ms, at]) => `${ms.toFixed(0)} ms at ${at.toFixed(1)} s`).join(', ')}; GPU per frame median ${gp.gpuMedian?.toFixed(1)} ms, max ${gp.gpuMax?.toFixed(1)} ms`);
  if (gp?.bins) console.log(`  by 2 s from the first step (gaps over 50 ms/longest ms): ${gp.bins.map(([n, ms]) => `${n}/${ms.toFixed(0)}`).join(' ')}`);
  const f = got.find((g) => g.ev === 'frames');
  if (f?.median) console.log(`  GPU time per frame at ${f.w} x ${f.h}: median ${f.median.toFixed(2)} ms, p90 ${f.p90.toFixed(2)} ms`);
}
