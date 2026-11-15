// The commands that drive pages: trace, stills, drive, perf; and the helpers the checks share.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sleep } from './browser.mjs';
import { formatTrace } from './trace.mjs';
import { diffPng, fmtDiff } from './png.mjs';

const VIEWS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'views.json'), 'utf8'));

export const parseSize = (s) => {
  const [w, h] = s.split('x').map(Number);
  if (!(w > 0 && h > 0)) throw new Error(`--size WxH, not ${s}`);
  return { w, h };
};

// A view of views.json by name, with its frames and ms; or a plain query.
export function view(name, q) {
  if (name) {
    const v = VIEWS.views.find((x) => x.name === name);
    if (!v) throw new Error(`no view ${name} in views.json (${VIEWS.views.map((x) => x.name).join(', ')})`);
    return { frames: VIEWS.frames, ms: VIEWS.ms, ...v, q: stillQuery(v.q) };
  }
  return { name: 'query', frames: VIEWS.frames, ms: VIEWS.ms, q: q || '' };
}
// A still stands at rest: speed=0 unless the query sets the speed.
export const stillQuery = (q) => (/(^|&)speed=/.test(q) ? q : q ? q + '&speed=0' : 'speed=0');
export const viewNames = () => VIEWS.views.map((v) => v.name);

// A base page: a directory, or a git revision of this repository, exported to a temporary directory.
export function resolveBase(spec, repo) {
  if (fs.existsSync(spec) && fs.statSync(spec).isDirectory()) return path.resolve(spec);
  const rev = spawnSync('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', spec + '^{commit}'], { encoding: 'utf8' });
  if (rev.status !== 0) throw new Error(`--base ${spec}: neither a directory nor a git revision`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir().length <= 24 ? os.tmpdir() : '/tmp', 'sky-base-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  const tar = spawnSync('git', ['-C', repo, 'archive', '--format=tar', rev.stdout.trim()], { maxBuffer: 1 << 30 });
  const x = spawnSync('tar', ['-x', '-C', dir], { input: tar.stdout });
  if (tar.status !== 0 || x.status !== 0) throw new Error(`--base ${spec}: git archive failed`);
  console.log(`base: ${spec} (${rev.stdout.trim().slice(0, 12)}) in ${dir}`);
  return dir;
}

// Loads a view, steps its frames and saves a still. Returns { file, errors }.
export async function still(session, root, v, size, file) {
  const p = await session.open(root, v.q, size);
  try {
    await p.step(v.frames, v.ms);
    await p.shot(file);
    return { file, errors: p.errors };
  } finally {
    await p.close();
  }
}

// Traces use one size on every renderer, so that traces of the GPU and of SwiftShader can be compared.
export const TRACE_SIZE = '480x270';
export async function trace(session, root, { view: name, q, frames, ms, size, file }) {
  const v = name ? view(name) : view(null, q || '');
  const n = frames || 12, step = ms || 16;
  const t0 = Date.now();
  const p = await session.open(root, v.q, { ...size, trace: n });
  try {
    await p.step(n, step);
    const dump = await p.trace();
    const text = formatTrace(dump, [`query ?${v.q}`, `size ${size.w}x${size.h}, ${n} frames of ${step} ms`,
      `renderer ${session.chrome.renderer}: ${await session.renderer()}`]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return { file, lines: text.split('\n').length - 1, bytes: text.length, seconds: ((Date.now() - t0) / 1000).toFixed(1), errors: p.errors, warnings: p.warnings };
  } finally {
    await p.close();
  }
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
    const r = await still(session, root, v, size, path.join(dir, `${name}.png`));
    let line = `${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`;
    const row = { name, q: v.q, page: `${name}.png` };
    if (base) {
      const b = await still(session, base, v, size, path.join(dir, `${name}.base.png`));
      r.errors.push(...b.errors.map((e) => 'base: ' + e));
      const d = diffPng(path.join(dir, `${name}.base.png`), r.file, { out: path.join(dir, `${name}.diff.png`) });
      Object.assign(row, { base: `${name}.base.png`, diff: `${name}.diff.png`, stats: fmtDiff(d) });
      line += `, against the base: ${fmtDiff(d)}`;
      if (d.max) ok = false;
    }
    if (r.errors.length) { ok = false; line += '\n  ERRORS: ' + r.errors.join('\n  '); }
    console.log(line);
    rows.push(row);
  }
  const cell = (f) => (f ? `<td><a href="${f}"><img src="${f}" width="${Math.min(size.w, 480)}"></a></td>` : '');
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

// Real time, no fake clock: the time from navigation to the first drawArrays of each canvas, the frame rate, and
// per canvas and kind of draw (target, size, program) the GPU time (EXT_disjoint_timer_query_webgl2).
const PERF = `(() => {
  const G = window.__perf = { first: {}, kinds: {}, on: false };
  const P = WebGL2RenderingContext.prototype, draw = P.drawArrays, use = P.useProgram, bind = P.bindFramebuffer, vp = P.viewport;
  const pend = [];
  let ids = 0;
  P.useProgram = function (p) { this.__prog = p ? (p.__id || (p.__id = ++ids)) : 0; return use.call(this, p); };
  P.bindFramebuffer = function (t, f) { if (t !== this.READ_FRAMEBUFFER) this.__fb = f; return bind.call(this, t, f); };
  P.viewport = function (x, y, w, h) { this.__vp = w + 'x' + h; return vp.call(this, x, y, w, h); };
  P.drawArrays = function (...a) {
    const id = this.canvas.id || '?';
    if (!(id in G.first)) G.first[id] = performance.now();
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
export async function perf(session, root, { q, size, seconds }) {
  if (q && !q.startsWith('?')) q = '?' + q;
  const { targetId } = await session.chrome.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await session.chrome.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => session.chrome.send(m, p, sessionId);
  const ev = async (expression) => (await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await s('Page.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
  await s('Page.addScriptToEvaluateOnNewDocument', { source: PERF });
  await s('Page.navigate', { url: session.server.url(root) + (q || '') });
  for (let i = 0; i < 600 && (await ev('document.readyState')) !== 'complete'; i++) await sleep(100);
  await sleep(1500);
  await ev('window.__perf.on = true, 0');
  const fps = await ev(`new Promise((res) => { let n = 0, t0 = performance.now(), last = t0, worst = 0;
    const f = (t) => { n++; worst = Math.max(worst, t - last); last = t;
      if (t - t0 < ${seconds * 1000}) requestAnimationFrame(f); else res({ fps: +(n / ((t - t0) / 1000)).toFixed(1), worstMs: +worst.toFixed(1) }); };
    requestAnimationFrame(f); })`);
  await sleep(300);
  const g = await ev('JSON.stringify(window.__perf)').then(JSON.parse);
  console.log(`first draw (ms after navigation start): ${Object.entries(g.first).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ')}`);
  console.log(`frame rate: ${fps.fps} per second, longest gap ${fps.worstMs} ms`);
  for (const [k, a] of Object.entries(g.kinds).sort()) {
    a.sort((x, y) => x - y);
    console.log(`${k}: ${a.length} draws, GPU ms median ${a[a.length >> 1].toFixed(2)}, p90 ${a[Math.floor(a.length * 0.9)].toFixed(2)}`);
  }
  if (!Object.keys(g.kinds).length) console.log('no GPU times (no draws while measuring, or no timer extension)');
  await session.chrome.send('Target.closeTarget', { targetId });
  return 0;
}
