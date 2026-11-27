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
// frame once the first picture shows (EXT_disjoint_timer_query_webgl2 around the frame's callback), then `done`,
// then goes on to the next view of a chain, if any.
// With d3dShot=S, it posts instead the canvas as a PNG S s after the first picture, then `done`.
// With d3dSources, it posts instead, once the first picture shows, the programs the page has linked
// (window.__programs(): each one's name and the text of its fragment shader as compiled), then `done`; for a page
// from before window.__programs, the fragment shaders its linkProgram calls were given.
// With d3dSwitch=W, it chooses the weather W in the panel d3dAt s (default 5) after the first picture, and posts
// instead the wait until the console line "middle clouds built" (none within 60 s: null; a weather without middle
// clouds waits 8 s) and the gaps between animation frames from the choice to 1 s after.
const INJECT = `<script>(() => {
  const q = new URLSearchParams(location.search), run = q.get('d3d'), FRAMES = +(q.get('d3dFrames') || 60), SHOT = +(q.get('d3dShot') || 0);
  const SWITCH = q.get('d3dSwitch'), AT = +(q.get('d3dAt') || 5), SOURCES = q.has('d3dSources');
  let built = 0;
  const post = o => fetch('/d3d/report/' + run, { method: 'POST', body: JSON.stringify(Object.assign({ at: performance.now() / 1000 }, o)) }).catch(() => {});
  for (const k of ['info', 'log', 'warn', 'error']) {
    const f = console[k];
    console[k] = (...a) => {
      const msg = a.map(String).join(' ').slice(0, 500);
      if (!built && /middle clouds built/.test(msg)) built = performance.now();
      post({ ev: 'console', msg });
      f.apply(console, a);
    };
  }
  let gl = null, ext = null, started = false, done = false;
  const linked = [];
  if (SOURCES) {
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (p) {
      const f = (this.getAttachedShaders(p) || []).find(s => this.getShaderParameter(s, this.SHADER_TYPE) === this.FRAGMENT_SHADER);
      if (f) linked.push(this.getShaderSource(f));
      return link.call(this, p);
    };
  }
  const times = [], pending = [], frames = [];
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
  // After \`done\`, the next view of a chain (d3dperf), if the server has one: the same Chrome, so its programs
  // may come from the GPU process's cache.
  const finish = o => {
    done = true;
    post(o).then(() => post({ ev: 'done' })).then(() => fetch('/d3d/next/' + run)).then(r => (r.ok ? r.text() : ''))
      .then(u => { if (u) location.replace(u); }).catch(() => {});
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(ts => {
    frames.push(performance.now());
    let query = null;
    if (ext && started && !done && !gl.isContextLost()) { query = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, query); }
    try { cb(ts); } finally {
      if (query) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(query); }
      while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const p = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p);
      }
      if (!done && !SHOT && !SWITCH && !SOURCES && times.length >= FRAMES + 10) {
        const t = times.slice(10, FRAMES + 10), s = [...t].sort((a, b) => a - b);
        finish({ ev: 'frames', median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], mean: t.reduce((a, b) => a + b, 0) / t.length,
          times: t.map(x => +x.toFixed(3)), w: gl.drawingBufferWidth, h: gl.drawingBufferHeight });
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
      if (SOURCES) finish({ ev: 'sources', list: window.__programs ? window.__programs() : null, linked });
      else if (SHOT) setTimeout(() => finish({ ev: 'shot', png: document.getElementById('sky').toDataURL('image/png') }), SHOT * 1000);
      else if (SWITCH && !hero.classList.contains('failed')) setTimeout(async () => {
        const list = document.getElementById('weather'), at = performance.now();
        list.value = SWITCH;
        built = 0;
        list.dispatchEvent(new Event('change', { bubbles: true }));
        // (A weather without middle clouds, its slider at 0: 8 s.)
        const limit = +document.getElementById('mid').value > 0 ? 60000 : 8000;
        while (!built && performance.now() - at < limit) await new Promise(r => setTimeout(r, 50));
        await new Promise(r => setTimeout(r, 1000));
        const end = (built || performance.now() - 1000) + 1000, gaps = [];
        for (let i = 1; i < frames.length; i++) if (frames[i] > at && frames[i - 1] < end) gaps.push([frames[i - 1] - at, frames[i] - frames[i - 1]]);
        const top = gaps.reduce((m, g) => (g[1] > m[1] ? g : m), [0, 0]);
        finish({ ev: 'switch', weather: SWITCH, after: AT, wait: built ? (built - at) / 1000 : null, gap: top[1], gapAt: top[0] / 1000,
          gaps: gaps.filter(g => g[1] > 100).map(([t, d]) => [+(t / 1000).toFixed(2), Math.round(d)]) });
      }, AT * 1000);
      else if (!ext || hero.classList.contains('failed')) finish({ ev: 'frames' });
    }
  }, 20);
})();</script>`;

// The harness page of \`programs\`: compiles each program of the page alone (as makeSky links it), polling
// KHR_parallel_shader_compile, then draws it into a 4 x 4 framebuffer once with one target and once with all its
// outputs (ANGLE on Direct3D 11 compiles a program again for a draw into more than one target, while the GPU
// process waits). Each draw is timed by a read of a pixel after it.
// With hlsl (fxc), instead of the draws: the HLSL that ANGLE gave Microsoft's compiler for the fragment shader
// (the part COMPILER INPUT HLSL of WEBGL_debug_shaders, which needs --enable-privileged-webgl-extensions).
const PROGRAMS = `<!doctype html><meta charset="utf-8"><canvas width="4" height="4"></canvas><script>(async () => {
  const run = new URLSearchParams(location.search).get('d3d'), HLSL = new URLSearchParams(location.search).has('hlsl');
  const dbg = HLSL ? document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_debug_shaders') : null;
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
    let frag = null;
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, source]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(prog, s);
      frag = s;
    }
    gl.linkProgram(prog);
    gl.flush();
    while (par && !gl.getProgramParameter(prog, par.COMPLETION_STATUS_KHR)) await new Promise(r => setTimeout(r, 10));
    const r = { ev: 'program', name, link: Math.round(performance.now() - t0) };
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { await post({ ...r, error: gl.getProgramInfoLog(prog) || gl.getShaderInfoLog(frag) }); continue; }
    if (HLSL) {
      const m = /\\/\\/ COMPILER INPUT HLSL BEGIN\\n([\\s\\S]*?)\\/\\/ COMPILER INPUT HLSL END/.exec(dbg ? dbg.getTranslatedShaderSource(frag) : '');
      await post({ ...r, hlsl: m ? m[1] : null });
      continue;
    }
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

// The programs the page linked (window.__programs(), posted by a run with d3dSources), with the outputs each
// fragment shader declares.
const withOutputs = (list) => list.map(({ name, source }) => ({ name, source,
  outputs: [...source.matchAll(/^\s*(?:layout\(location = (\d+)\)\s*)?out\s+(\w+)\s+(\w+);/gm)]
    .map((o) => ({ location: +(o[1] || 0), type: o[2], name: o[3] })) }));

// The Chrome processes started with a profile (by its path on their command line).
const processesOf = (prof) => win('powershell.exe', ['-NoProfile', '-Command',
  `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${prof}*' } | ForEach-Object { $_.ProcessId }`])
  .split('\n').map((s) => s.trim()).filter(Boolean);
const kill = (pids) => {
  for (const pid of pids) { try { win('taskkill.exe', ['/PID', pid, '/T', '/F']); } catch {} }
};
// The run going on, for the exit handler: an interrupted run kills its Chrome too.
let current = null, fxcDir = null;
process.on('exit', () => {
  if (fxcDir) try { fs.rmSync(fxcDir, { recursive: true, force: true }); } catch {}
  if (!current) return;
  try { kill(processesOf(current.prof)); fs.rmSync(current.dir, { recursive: true, force: true }); } catch {}
});

// One headless Windows Chrome on Direct3D 11 at url, until finished() (the page reported `done`) or `limit` s
// pass. Returns true when it was stopped by the limit.
export async function runChrome(url, finished, id, { limit, size, flags = [] }) {
  const temp = winTemp(), prof = `sky-d3d-${process.pid}-${id}`;
  fs.mkdirSync(path.join(temp.wsl, prof));
  current = { prof, dir: path.join(temp.wsl, prof) };
  const child = spawn(CHROME, ['--headless=new', '--use-angle=d3d11', `--user-data-dir=${temp.win}\\${prof}`,
    '--disable-gpu-shader-disk-cache', '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--window-size=${size.w},${size.h}`, ...flags, url], { cwd: '/mnt/c', stdio: 'ignore' });
  let failed = null;
  child.on('error', (e) => (failed = String(e)));
  const t0 = Date.now();
  while (Date.now() - t0 < limit * 1000 && !finished() && !failed) await sleep(250);
  if (failed) throw new Error(`d3d: Chrome did not start: ${failed}`);
  const timedOut = !finished();
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

// The Windows Chrome to run, or null on a machine without it.
export const windowsChrome = () => (fs.existsSync(CHROME) ? CHROME : null);
export const CHROME_PATH = CHROME;

// The local server of a d3d run: the pages and harness files (files: path -> text), the reports each run posts
// (reports: id -> list), and the next view of a chain (next: id -> URL).
export async function d3dServer() {
  const reports = new Map(), files = new Map(), next = new Map();
  const server = await startServer({
    handle(req, res, url) {
      const m = /^\/d3d\/(report\/(\w+)|page\/(\w+)\/index\.html|programs\/(\w+)\.(json|html)|next\/(\w+))$/.exec(url.pathname);
      if (!m) return false;
      if (m[6]) {
        const to = next.get(m[6]);
        res.writeHead(to ? 200 : 404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        res.end(to || '');
        return true;
      }
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
  return { reports, files, next, port, close: () => server.close() };
}

// The page with the script above, served at /d3d/page/<key>/index.html.
export const servePage = (srv, key, html) => srv.files.set(`/d3d/page/${key}/index.html`, html.replace('<head>', '<head>\n' + INJECT));
// The URL of a page served under key, as run id, with ?timing&res=1 and the query (its quality max unless named),
// timing `frames` frames.
export const pageUrl = (srv, key, id, q, frames) =>
  `http://localhost:${srv.port}/d3d/page/${key}/index.html?timing&res=1&${withQuality(q)}&d3d=${id}&d3dFrames=${frames}`;

// The programs a page links at its start (with --q), from one run of the page itself (d3dSources): their names
// and fragment shaders as makeSky makes them.
async function sourcesOf(srv, page, key, { q, limit, size }) {
  const id = `src${key}`;
  servePage(srv, id, fs.readFileSync(path.join(page.dir, 'index.html'), 'utf8'));
  srv.reports.set(id, []);
  await runChrome(pageUrl(srv, id, id, q, 0) + '&d3dSources', () => srv.reports.get(id).some((g) => g.ev === 'done'), id, { limit, size });
  const got = srv.reports.get(id).find((g) => g.ev === 'sources');
  const list = got?.list || (got?.linked?.length ? named(got.linked, fs.readFileSync(path.join(page.dir, 'index.html'), 'utf8')) : null);
  if (!list?.length) throw new Error(`d3d: ${page.name} posted no programs`);
  return withOutputs(list);
}

// The names of a page's programs from before window.__programs, as makeSky gives them: the shader's script (the one
// whose last lines the source ends with), and the defines without a value after its #version line (the link's).
function named(linked, html) {
  const scripts = [...html.matchAll(/<script id="(\w+)" type="x-shader\/x-fragment">([\s\S]*?)<\/script>/g)].map((m) => [m[1], m[2].trim().slice(-300)]);
  const seen = new Set();
  return linked.map((source, i) => {
    const id = scripts.find(([, tail]) => source.trim().endsWith(tail))?.[0] || `program ${i + 1}`;
    const head = source.split('\n').slice(1, 100);
    const defs = [];
    for (const l of head) { const m = /^#define (\w+)\s*$/.exec(l); if (m) defs.push(m[1]); else if (!/^#define /.test(l)) break; }
    return { name: id + (defs.length ? ` (${defs.join('\n')})` : ''), source };
  }).filter(({ name }) => !seen.has(name) && seen.add(name));
}

// D3DCompile of d3dcompiler_47.dll (Windows' own), from PowerShell: each file of the list (one Windows path a
// line) compiled for ps_5_0 with ANGLE's macro ANGLE_ENABLE_LOOP_FLATTEN and D3DCOMPILE_OPTIMIZATION_LEVEL2; one
// line each: the file, the CPU time and the wall time of the compile (ms), the size of the code and its number
// of instructions.
const FXC_PS1 = String.raw`param([string]$list)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class Fxc {
  [StructLayout(LayoutKind.Sequential)] public struct Macro { public IntPtr Name; public IntPtr Def; }
  [DllImport("D3DCompiler_47.dll")] public static extern int D3DCompile(byte[] src, UIntPtr size, string name, Macro[] defines, IntPtr include, string entry, string target, uint flags1, uint flags2, out IntPtr code, out IntPtr errors);
  [DllImport("D3DCompiler_47.dll")] public static extern int D3DDisassemble(IntPtr src, UIntPtr size, uint flags, string comments, out IntPtr dis);
  [ComImport, Guid("8BA5FB08-5195-40e2-AC58-0D989C3A0102"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IBlob { [PreserveSig] IntPtr GetBufferPointer(); [PreserveSig] UIntPtr GetBufferSize(); }
  public static string Run(string path) {
    byte[] src = System.IO.File.ReadAllBytes(path);
    Macro[] m = new Macro[] { new Macro { Name = Marshal.StringToHGlobalAnsi("ANGLE_ENABLE_LOOP_FLATTEN"), Def = Marshal.StringToHGlobalAnsi("1") }, new Macro() };
    IntPtr code, err;
    var p = System.Diagnostics.Process.GetCurrentProcess();
    double cpu0 = p.TotalProcessorTime.TotalMilliseconds;
    var sw = System.Diagnostics.Stopwatch.StartNew();
    int hr = D3DCompile(src, (UIntPtr)src.Length, "fs", m, IntPtr.Zero, "main", "ps_5_0", 0xC000, 0, out code, out err);
    double wall = sw.Elapsed.TotalMilliseconds;
    p.Refresh();
    double cpu = p.TotalProcessorTime.TotalMilliseconds - cpu0;
    long size = 0; int ins = 0;
    if (code != IntPtr.Zero) {
      var b = (IBlob)Marshal.GetObjectForIUnknown(code); size = (long)b.GetBufferSize();
      IntPtr dis;
      if (D3DDisassemble(b.GetBufferPointer(), b.GetBufferSize(), 0, null, out dis) == 0) {
        var db = (IBlob)Marshal.GetObjectForIUnknown(dis);
        foreach (var l in Marshal.PtrToStringAnsi(db.GetBufferPointer()).Split('\n')) { var t = l.TrimStart(); if (l.Length > t.Length && t.Length > 0 && char.IsLower(t[0]) && !t.StartsWith("dcl_")) ins++; }
      }
    }
    return String.Format("{0}\t{1:F0}\t{2:F0}\t{3}\t{4}\t{5}", System.IO.Path.GetFileName(path), cpu, wall, size, ins, hr == 0 ? "ok" : "hr=0x" + hr.ToString("x8"));
  }
}
"@
foreach ($f in Get-Content $list) { if ($f) { Write-Output ([Fxc]::Run($f)) } }
`;

// `d3d fxc`: each program's HLSL compiled alone by Microsoft's compiler, `runs` times, the pages' files in turns.
async function fxc(srv, pages, { q, runs, limit, size }) {
  const temp = winTemp(), dirName = `sky-fxc-${process.pid}`;
  fxcDir = path.join(temp.wsl, dirName);
  fs.mkdirSync(fxcDir);
  try {
    const files = [];
    for (const [p, page] of pages.entries()) {
      const list = await sourcesOf(srv, page, `f${p}`, { q, limit, size });
      const id = `h${p}`;
      srv.files.set(`/d3d/programs/${id}.html`, PROGRAMS.replace("fetch('/d3d/programs.json')", `fetch('/d3d/programs/${id}.json')`));
      srv.files.set(`/d3d/programs/${id}.json`, JSON.stringify(list));
      srv.reports.set(id, []);
      await runChrome(`http://localhost:${srv.port}/d3d/programs/${id}.html?d3d=${id}&hlsl`, () => srv.reports.get(id).some((g) => g.ev === 'done'),
        id, { limit, size, flags: ['--enable-privileged-webgl-extensions'] });
      for (const [k, g] of srv.reports.get(id).filter((g) => g.ev === 'program').entries()) {
        if (!g.hlsl) { console.log(`  ${page.name}: ${g.name}: no HLSL${g.error ? ` (${g.error.slice(0, 200)})` : ''}`); continue; }
        const file = `p${p}-${k}.hlsl`;
        fs.writeFileSync(path.join(fxcDir, file), g.hlsl);
        files.push({ page: page.name, name: g.name, file, link: g.link });
      }
    }
    // In turns: each program of each page, then the next run.
    const names = [...new Set(files.map((f) => f.name))], order = [];
    for (let r = 0; r < runs; r++) for (const n of names) for (const f of files.filter((f) => f.name === n)) order.push(f);
    fs.writeFileSync(path.join(fxcDir, 'list.txt'), order.map((f) => `${temp.win}\\${dirName}\\${f.file}`).join('\r\n'));
    fs.writeFileSync(path.join(fxcDir, 'fxc.ps1'), FXC_PS1);
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', `${temp.win}\\${dirName}\\fxc.ps1`,
      '-list', `${temp.win}\\${dirName}\\list.txt`], { encoding: 'utf8', cwd: '/mnt/c', timeout: limit * 1000 * runs * pages.length, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '');
    const got = new Map();
    for (const line of out.split('\n')) {
      const [file, cpu, wall, bytes, ins, status] = line.split('\t');
      if (!status) continue;
      const g = got.get(file) || { cpu: [], wall: [], bytes: +bytes, ins: +ins, status };
      g.cpu.push(cpu / 1000);
      g.wall.push(wall / 1000);
      got.set(file, g);
    }
    printFxc(pages, names, files, got);
    return { files, got: Object.fromEntries(got) };
  } finally {
    fs.rmSync(fxcDir, { recursive: true, force: true });
    fxcDir = null;
  }
}

const median = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const span = (v) => v.length ? `${median(v).toFixed(2)} (${Math.min(...v).toFixed(2)}-${Math.max(...v).toFixed(2)})` : '-';

// One line a program: each page's CPU time (median and range of the runs), and the page's against the first.
function printFxc(pages, names, files, got) {
  console.log(`fxc: CPU time of Microsoft's compiler, s, median (range) of ${got.size ? got.values().next().value.cpu.length : 0} runs; instructions`);
  console.log('  ' + 'program'.padEnd(28) + pages.map((p) => p.name.padEnd(30)).join('') + (pages.length > 1 ? 'ratio' : ''));
  const sums = pages.map(() => []);
  for (const n of names) {
    const cells = pages.map((p) => { const f = files.find((f) => f.page === p.name && f.name === n); return f && got.get(f.file); });
    cells.forEach((c, i) => { if (c) c.cpu.forEach((v, r) => (sums[i][r] = (sums[i][r] || 0) + v)); });
    const ratio = cells.length > 1 && cells[0] && cells[cells.length - 1] && median(cells[0].cpu) >= 0.05 ? (median(cells[cells.length - 1].cpu) / median(cells[0].cpu)).toFixed(3) + 'x' : '';
    console.log('  ' + n.slice(0, 27).padEnd(28) + cells.map((c) => (c ? `${span(c.cpu)} ${c.ins}${c.status === 'ok' ? '' : ' ' + c.status}` : '-').padEnd(30)).join('') + ratio);
  }
  const ratio = sums.length > 1 ? (median(sums[sums.length - 1]) / median(sums[0])).toFixed(3) + 'x' : '';
  console.log('  ' + 'sum'.padEnd(28) + sums.map((v) => span(v).padEnd(30)).join('') + ratio);
}

// `node tools/sky.mjs d3d [page|programs|switch|fxc] ...`: see tools/README.md.
export async function d3d(pages, { mode = 'page', q = '', runs = 1, limit = 300, frames = 60, size = { w: 1920, h: 1080 }, shot = 0, out = null, weather = 'altocumulus', at = 5 }) {
  if (!windowsChrome()) throw new Error(`d3d: no Windows Chrome at ${CHROME} (SKY_WIN_CHROME)`);
  const srv = await d3dServer(), { reports, files, port } = srv;
  const results = [];
  try {
    if (mode === 'fxc') return await fxc(srv, pages, { q, runs, limit, size });
    // (programs: each page's own programs, taken once from a run of the page.)
    const lists = [];
    if (mode === 'programs') for (const [p, page] of pages.entries()) lists.push(await sourcesOf(srv, page, `s${p}`, { q, limit, size }));
    for (let r = 0; r < runs; r++) {
      for (const [p, page] of pages.entries()) {
        const id = `${r}x${p}`, html = fs.readFileSync(path.join(page.dir, 'index.html'), 'utf8');
        let url;
        if (mode === 'programs') {
          files.set(`/d3d/programs/${id}.html`, PROGRAMS.replace("fetch('/d3d/programs.json')", `fetch('/d3d/programs/${id}.json')`));
          files.set(`/d3d/programs/${id}.json`, JSON.stringify(lists[p]));
          url = `http://localhost:${port}/d3d/programs/${id}.html?d3d=${id}`;
        } else {
          servePage(srv, id, html);
          // (A picture is taken at the page's own drawing size: no res=1.)
          url = shot ? `http://localhost:${port}/d3d/page/${id}/index.html?timing&${withQuality(q)}&d3d=${id}&d3dShot=${shot}`
            : pageUrl(srv, id, id, q, frames) + (mode === 'switch' ? `&d3dSwitch=${encodeURIComponent(weather)}&d3dAt=${at}` : '');
        }
        reports.set(id, []);
        const timedOut = await runChrome(url, () => reports.get(id).some((g) => g.ev === 'done'), id, { limit, size });
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
    srv.close();
  }
  if (mode === 'switch' && runs > 1) summary(results);
  return results;
}

// The median and range of each page's switch runs.
function summary(results) {
  const span = (list, digits) => {
    const v = list.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
    return v.length ? `${v[v.length >> 1].toFixed(digits)} (${v[0].toFixed(digits)}-${v[v.length - 1].toFixed(digits)})` : '-';
  };
  console.log('median (range):');
  for (const name of [...new Set(results.map((r) => r.page))]) {
    const rs = results.filter((r) => r.page === name), sw = rs.map((r) => r.got.find((g) => g.ev === 'switch') || {});
    console.log(`  ${name}: first picture ${span(rs.map((r) => r.got.find((g) => g.ev === 'shown')?.at), 1)} s, ` +
      `built after ${span(sw.map((g) => g.wait), 2)} s, longest gap ${span(sw.map((g) => g.gap), 0)} ms`);
  }
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
  const sw = got.find((g) => g.ev === 'switch');
  if (sw) {
    console.log(`  ${sw.weather} chosen ${sw.after} s after the first picture: ` + (sw.wait === null ? 'no "middle clouds built"' : `middle clouds built after ${sw.wait.toFixed(2)} s`) +
      `; longest frame gap ${Math.round(sw.gap)} ms, ${sw.gapAt.toFixed(2)} s after the choice; gaps over 100 ms (s after the choice, ms): ${sw.gaps.map(([t, d]) => `${t} ${d}`).join(', ') || 'none'}`);
  }
  const f = got.find((g) => g.ev === 'frames');
  if (f?.median) console.log(`  GPU time per frame at ${f.w} x ${f.h}: mean ${f.mean.toFixed(2)} ms, median ${f.median.toFixed(2)} ms, p90 ${f.p90.toFixed(2)} ms`);
}
