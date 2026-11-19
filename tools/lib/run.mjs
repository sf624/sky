// The commands that drive pages: trace, stills, drive, perf; and the helpers the checks share.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { shortTmp, sleep, withQuality } from './browser.mjs';
import { formatTrace } from './trace.mjs';
import { diffPng, fmtDiff } from './png.mjs';

const VIEWS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'views.json'), 'utf8'));

export const parseSize = (s) => {
  const [w, h] = s.split('x').map(Number);
  if (!(w > 0 && h > 0)) throw new Error(`--size WxH, not ${s}`);
  return { w, h };
};

// A view of views.json by name, with its frames and ms; or a plain query as a still.
export function view(name, q) {
  if (name) {
    const v = VIEWS.views.find((x) => x.name === name);
    if (!v) throw new Error(`no view ${name} in views.json (${VIEWS.views.map((x) => x.name).join(', ')})`);
    return { frames: VIEWS.frames, ms: VIEWS.ms, ...v, q: stillQuery(v.q) };
  }
  return { name: 'query', frames: VIEWS.frames, ms: VIEWS.ms, q: q || '' };
}
export const viewSettings = () => ({ frames: VIEWS.frames, ms: VIEWS.ms });
// A still stands at rest: speed=0 unless the query sets the speed.
export const stillQuery = (q) => (/(^|&)speed=/.test(q) ? q : q ? q + '&speed=0' : 'speed=0');
export const viewNames = () => VIEWS.views.map((v) => v.name);

// A base page: a directory, or a git revision of this repository, exported to a temporary directory.
export function resolveBase(spec, repo) {
  if (fs.existsSync(spec) && fs.statSync(spec).isDirectory()) return path.resolve(spec);
  const rev = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', spec + '^{commit}'], { encoding: 'utf8' });
  if (rev.status !== 0) throw new Error(`--base ${spec}: neither a directory nor a git revision`);
  const dir = fs.mkdtempSync(path.join(shortTmp(), 'sky-base-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const tar = spawnSync('git', ['-C', repo, 'archive', '--format=tar', rev.stdout.trim()], { maxBuffer: 1 << 30 });
  const x = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout });
  if (tar.status !== 0 || x.status !== 0) throw new Error(`--base ${spec}: git archive failed`);
  console.log(`base: ${spec} (${rev.stdout.trim().slice(0, 12)}) in ${dir}`);
  return dir;
}

// Runs a view as views.json describes it: loads it, steps its frames (with its input after 2 frames), and saves
// a still (png) and/or its GL trace (traceFile). Returns { skip } when the machine lacks what the view needs, else
// { errors, warnings, lines, bytes }.
export async function runView(session, root, v, size, { png, traceFile } = {}) {
  if (v.font === 'ja' && !(await session.hasFont('ja'))) return { skip: 'no Japanese font on this machine' };
  const w = v.w || size.w, h = v.h || size.h;
  const p = await session.open(root, v.q, { w, h, dpr: v.dpr, hide: !v.ui, trace: traceFile ? v.frames : 0 });
  try {
    let left = v.frames;
    if (v.before || v.drag) {
      await p.step(2, v.ms);
      left -= 2;
      if (v.before) await p.eval(`(() => { ${v.before}; return 0; })()`);
      if (v.drag) {
        const [x0, y0, x1, y1] = v.drag.map((f, i) => Math.round(f * (i % 2 ? h : w)));
        await p.mouse({ type: 'mouseMoved', x: x0, y: y0 });
        await p.mouse({ type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
        for (let k = 1; k <= 5; k++) {
          await p.mouse({ type: 'mouseMoved', x: Math.round(x0 + (x1 - x0) * k / 5), y: Math.round(y0 + (y1 - y0) * k / 5), button: 'left', buttons: 1 });
        }
        await p.mouse({ type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
      }
    }
    await p.step(left, v.ms);
    if (png) await p.shot(png);
    const r = { errors: p.errors, warnings: p.warnings };
    if (traceFile) {
      const dump = await p.trace();
      const text = formatTrace(dump, [`query ?${v.q}`, `size ${w}x${h}${v.dpr ? ' at dpr ' + v.dpr : ''}, ${v.frames} frames of ${v.ms} ms`,
        `renderer ${session.chrome.renderer}: ${await session.renderer()}`]);
      fs.mkdirSync(path.dirname(traceFile), { recursive: true });
      fs.writeFileSync(traceFile, text);
      Object.assign(r, { lines: text.split('\n').length - 1, bytes: text.length, errors: [...p.errors, ...dump.errors.map((e) => 'trace: ' + e)] });
    }
    return r;
  } finally {
    await p.close();
  }
}

// The trace command: a view of views.json, or a query (by default the page as it opens, flying, 12 frames of
// 16 ms). Traces use one size on every renderer, so that traces of the GPU and of SwiftShader can be compared.
export const TRACE_SIZE = '480x270';
export async function trace(session, root, { view: name, q, frames, ms, size, file }) {
  const v = name ? view(name) : { name: 'query', q: q || '', frames: 12, ms: 16 };
  if (frames) v.frames = frames;
  if (ms) v.ms = ms;
  const t0 = Date.now();
  const r = await runView(session, root, v, size, { traceFile: file });
  return { file, seconds: ((Date.now() - t0) / 1000).toFixed(1), ...r, errors: r.errors || [], warnings: r.warnings || [] };
}

// Stills of the views (all, or a list), with an HTML page to look at them; with a base, each compared.
export async function stills(session, root, { views, size, dir, base }) {
  const names = views ? views.split(',') : viewNames();
  fs.mkdirSync(dir, { recursive: true });
  let ok = true;
  const rows = [];
  for (const name of names) {
    const v = view(name);
    const t0 = Date.now();
    const r = await runView(session, root, v, size, { png: path.join(dir, `${name}.png`) });
    if (r.skip) { console.log(`${name}: ${r.skip}: skipped`); continue; }
    let line = `${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`;
    const row = { name, q: v.q, page: `${name}.png` };
    if (base) {
      const b = await runView(session, base, v, size, { png: path.join(dir, `${name}.base.png`) });
      r.errors.push(...b.errors.map((e) => 'base: ' + e));
      const d = diffPng(path.join(dir, `${name}.base.png`), path.join(dir, `${name}.png`), { out: path.join(dir, `${name}.diff.png`) });
      Object.assign(row, { base: `${name}.base.png`, diff: `${name}.diff.png`, stats: fmtDiff(d) });
      line += `, against the base: ${fmtDiff(d)}`;
      if (d.max) ok = false;
    }
    if (r.errors.length) { ok = false; line += '\n  ERRORS: ' + r.errors.join('\n  '); }
    console.log(line);
    rows.push(row);
  }
  const cell = (f) => (f ? `<td><a href="${f}"><img src="${f}" width="480"></a></td>` : '');
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Stills</title>
<style>body{font:14px sans-serif;background:#222;color:#ddd}td{vertical-align:top;padding:4px}img{display:block}</style>
<table><tr><th></th><th>page</th>${base ? '<th>base</th><th>difference x8</th>' : ''}</tr>
${rows.map((r) => `<tr><td>${r.name}<br><small>?${r.q}</small><br><small>${r.stats || ''}</small></td>${cell(r.page)}${cell(r.base)}${cell(r.diff)}</tr>`).join('\n')}
</table>\n`);
  console.log(`${dir}/index.html`);
  return { ok };
}

// A scripted capture. SCRIPT: { q, w, h, dpr, hide (default true), seed, realDate, steps: [ ['step', n, ms], ['shot', file], ['shot', file, {x, y, width,
// height}], ['eval', js], ['mouse', {type, x, y, button, buttons, clickCount}], ['size', w, h], ['sleep', ms],
// ['draws'], ['frames', n] (real browser frames) ] }
export async function drive(session, root, script, size) {
  const p = await session.open(root, script.q || '', { w: script.w || size.w, h: script.h || size.h, hide: script.hide, dpr: script.dpr,
    seed: script.seed, ...(script.realDate ? { epoch: null } : {}) });
  try {
    for (const [op, a, b] of script.steps || []) {
      if (op === 'step') await p.step(a, b ?? 50);
      else if (op === 'shot') { await p.shot(path.resolve(a), b); console.log('shot:', path.resolve(a)); }
      else if (op === 'eval') console.log('eval:', JSON.stringify(await p.eval(a)));
      else if (op === 'mouse') await p.mouse(a);
      else if (op === 'size') await p.size(a, b);
      else if (op === 'sleep') await sleep(a);
      else if (op === 'draws') console.log('draws:', JSON.stringify(await p.draws()));
      else if (op === 'frames') for (let i = 0; i < (a || 1); i++) await p.eval('window.__realFrame().then(() => 0)');
      else throw new Error(`drive: unknown step ${op}`);
    }
    console.log(p.errors.length ? 'ERRORS:\n  ' + p.errors.join('\n  ') : 'no errors');
    return p.errors.length ? 1 : 0;
  } finally {
    await p.close();
  }
}

// Real time, no fake clock: the time from navigation to the first drawArrays of each canvas and to its first
// picture (the first draw to the canvas itself), the long tasks of the main thread until then, the frame rate,
// and per canvas and kind of draw (target, size, program) the GPU time (EXT_disjoint_timer_query_webgl2).
const PERF = `(() => {
  const G = window.__perf = { first: {}, picture: {}, long: [], kinds: {}, on: false };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) G.long.push([e.startTime, e.duration]); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  const P = WebGL2RenderingContext.prototype, draw = P.drawArrays, use = P.useProgram, bind = P.bindFramebuffer, vp = P.viewport;
  const pend = [];
  let ids = 0;
  P.useProgram = function (p) { this.__prog = p ? (p.__id || (p.__id = ++ids)) : 0; return use.call(this, p); };
  P.bindFramebuffer = function (t, f) { if (t !== this.READ_FRAMEBUFFER) this.__fb = f; return bind.call(this, t, f); };
  P.viewport = function (x, y, w, h) { this.__vp = w + 'x' + h; return vp.call(this, x, y, w, h); };
  P.drawArrays = function (...a) {
    const id = this.canvas.id || '?';
    if (!(id in G.first)) G.first[id] = performance.now();
    // The first picture: the first draw to the canvas once the page says it has loaded (data-sky, see page.mjs).
    if (!this.__fb && !(id in G.picture) && (document.querySelector('[data-sky]') || { dataset: {} }).dataset.sky !== 'loading') G.picture[id] = performance.now();
    if (this.__ext === undefined) this.__ext = this.getExtension('EXT_disjoint_timer_query_webgl2');
    const key = id + (this.__fb ? ' offscreen ' : ' canvas ') + (this.__vp || '?') + ' prog' + this.__prog;
    if (!G.on || !this.__ext) return draw.apply(this, a);
    const q = this.createQuery();
    this.beginQuery(this.__ext.TIME_ELAPSED_EXT, q);
    draw.apply(this, a);
    this.endQuery(this.__ext.TIME_ELAPSED_EXT);
    pend.push([this, q, key]);
  };
  setInterval(() => {
    for (let i = pend.length - 1; i >= 0; i--) {
      const [gl, q, key] = pend[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(gl.__ext.GPU_DISJOINT_EXT)) (G.kinds[key] || (G.kinds[key] = [])).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      pend.splice(i, 1);
    }
  }, 20);
})()`;
export async function perf(session, root, { q, size, seconds, dpr = 1, mobile = false, cpu = 1, noGpu = false }) {
  q = '?' + withQuality(q);
  const { targetId } = await session.chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => session.chrome.send(m, p, sessionId);
  const ev = async (expression) => (await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await s('Page.enable');
  // With ?timing, the page's console lines of its loading (see docs/design.md), printed at the end.
  const lines = [], listen = (m) => {
    if (m.sessionId === sessionId && m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'info' || m.params.type === 'error')) lines.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  };
  if (/(^|&)timing(=|&|$)/.test(q.slice(1))) {
    session.chrome.on(listen);
    await s('Runtime.enable');
  }
  await s('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: dpr, mobile });
  if (mobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  // --cpu N: the main thread N times slower, as a phone's (DevTools' CPU throttling).
  if (cpu > 1) await s('Emulation.setCPUThrottlingRate', { rate: cpu });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: PERF });
  await s('Page.navigate', { url: session.server.url(root) + (q || '') });
  // Until the load event, the end of the page's loading (data-sky, see page.mjs) and a first picture.
  const READY = `document.readyState === 'complete' && (document.querySelector('[data-sky]') || { dataset: {} }).dataset.sky !== 'loading'
    && (!document.querySelector('canvas') || Object.keys(window.__perf.picture).length > 0)`;
  for (let i = 0; i < 1200 && !(await ev(READY)); i++) await sleep(50);
  await sleep(1500);
  if (!noGpu) await ev('window.__perf.on = true, 0');
  const level = await ev(`[document.querySelector('#quality') && document.querySelector('#quality').value, (document.querySelector('canvas') || {}).width, (document.querySelector('canvas') || {}).height].join(' ')`);
  const fps = await ev(`new Promise((res) => { let n = 0, t0 = performance.now(), last = t0, worst = 0;
    const f = (t) => { n++; worst = Math.max(worst, t - last); last = t;
      if (t - t0 < ${seconds * 1000}) requestAnimationFrame(f); else res({ fps: +(n / ((t - t0) / 1000)).toFixed(1), worstMs: +worst.toFixed(1) }); };
    requestAnimationFrame(f); })`);
  await sleep(300);
  const g = await ev('JSON.stringify(window.__perf)').then(JSON.parse);
  const ms = (o) => Object.entries(o).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ') || 'none';
  console.log(`first draw (ms after navigation start): ${ms(g.first)}`);
  console.log(`first picture on a canvas (ms after navigation start): ${ms(g.picture)}`);
  const until = Math.max(0, ...Object.values(g.picture)), long = g.long.filter(([t]) => t <= until);
  console.log(`main thread until then: ${long.length} tasks over 50 ms` + (long.length ? `, the longest ${Math.max(...long.map(([, d]) => d)).toFixed(0)} ms,`
    + ` blocked ${long.reduce((a, [, d]) => a + d - 50, 0).toFixed(0)} ms (the time over 50 ms)` : ''));
  console.log(`quality and canvas: ${level}`);
  console.log(`frame rate: ${fps.fps} per second, longest gap ${fps.worstMs} ms`);
  const frames = Object.entries(g.kinds).filter(([k]) => k.includes(' canvas ')).reduce((a, [, v]) => a + v.length, 0), all = Object.values(g.kinds).flat().reduce((a, b) => a + b, 0);
  if (frames) console.log(`GPU ms per frame (all draws, over ${frames} frames shown): ${(all / frames).toFixed(2)}`);
  for (const [k, a] of Object.entries(g.kinds).sort()) {
    a.sort((x, y) => x - y);
    console.log(`${k}: ${a.length} draws, GPU ms median ${a[a.length >> 1].toFixed(2)}, p90 ${a[Math.floor(a.length * 0.9)].toFixed(2)}`);
  }
  if (!Object.keys(g.kinds).length) console.log('no GPU times (no draws while measuring, or no timer extension)');
  session.chrome.off(listen);
  // With ?stats in the query: the page's overlay as it stands at the end.
  const overlay = await ev(`(document.querySelector('.stats') || {}).textContent || ''`);
  if (overlay) console.log('stats:\n  ' + overlay.split('\n').join('\n  '));
  for (const l of lines) console.log(`console: ${l}`);
  await session.chrome.send('Target.closeTarget', { targetId });
  return 0;
}
