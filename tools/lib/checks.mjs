// The checks. Each returns { ok, msg } (or { skip }) and writes its pictures and traces under dir/NAME/.
// Those that compare with a base need --base; the others test the page alone.
import fs from 'node:fs';
import path from 'node:path';
import { compareTraces } from './trace.mjs';
import { diffPng, fmtDiff, readPng, shiftOf } from './png.mjs';
import * as run from './run.mjs';

const WEATHER_KM = 256;   // the way flown wraps here (the page's WEATHER_KM)
const KMS = (kmh) => kmh / 3600;

// The place reached after flying frames frames of ms each from (x, z), heading in degrees: the first frame does
// not move (the page starts its clock there).
const reached = (x, z, kmh, heading, frames, ms) => {
  const d = KMS(kmh) * (frames - 1) * ms / 1000, h = heading * Math.PI / 180;
  const w = (v) => ((v % WEATHER_KM) + WEATHER_KM) % WEATHER_KM;
  return [w(x + d * Math.sin(h)), w(z + d * Math.cos(h))];
};
const at = ([x, z]) => `at=${x.toFixed(6)},${z.toFixed(6)}`;
const errorsOf = (pages) => pages.flatMap((p) => p.errors);

// Loads, steps, shoots; returns the closed page, whose errors stay readable.
async function shoot(ctx, root, q, steps, file, extra = {}) {
  const p = await ctx.session.open(root, q, { ...ctx.size, ...extra });
  try {
    for (const [n, ms] of steps) await p.step(n, ms);
    await p.shot(file);
    return p;
  } finally {
    await p.close();
  }
}
const stillAt = (ctx, root, q, file) => shoot(ctx, root, run.stillQuery(q), [[run.view('default').frames, 50]], file);

// One run of each view per page, shared by the checks trace and stills: its still and its GL trace.
async function viewRun(ctx, who, name) {
  const key = who + ':' + name;
  if (!ctx.runs.has(key)) {
    const dir = path.join(ctx.out, 'views');
    const files = { png: path.join(dir, `${name}.${who}.png`), traceFile: path.join(dir, `${name}.${who}.trace`) };
    const r = await run.runView(ctx.session, who === 'base' ? ctx.base : ctx.page, run.view(name), ctx.size, files);
    ctx.runs.set(key, { ...r, ...files });
  }
  return ctx.runs.get(key);
}

export const CHECKS = {
  // The GL trace of every view, to the end of its run, against the base's: every call, every upload and every
  // read-back the same. This proves the commands and the buffers; the stills prove the picture as composited.
  async trace(ctx) {
    if (!ctx.base) return { skip: 'needs --base' };
    const ignore = new Set(ctx.ignore.split(',').filter(Boolean));
    const lines = [], skipped = [];
    let ok = true, n = 0;
    for (const name of run.viewNames()) {
      const b = await viewRun(ctx, 'base', name), p = await viewRun(ctx, 'page', name);
      if (b.skip || p.skip) { skipped.push(`${name} (${b.skip || p.skip})`); continue; }
      const errors = [...b.errors.map((e) => 'base: ' + e), ...p.errors];
      if (errors.length) { ok = false; lines.push(`${name}: ERRORS ${errors.join(' | ')}`); }
      const r = compareTraces(fs.readFileSync(b.traceFile, 'utf8'), fs.readFileSync(p.traceFile, 'utf8'), { ignore, max: 4 });
      n++;
      if (!r.same) { ok = false; lines.push(`${name}: ${r.summary}`, ...r.report.map((l) => '    ' + l)); }
    }
    const same = `${n} views, identical${ignore.size ? ` (ignoring ${[...ignore].join(', ')})` : ''}`;
    return { ok, msg: [...(ok ? [same] : lines), ...skipped.map((s) => 'skipped: ' + s)].join('\n') };
  },

  // Stills of every view against the base's: max difference 0.
  async stills(ctx) {
    if (!ctx.base) return { skip: 'needs --base' };
    const bad = [], errors = [], skipped = [];
    let n = 0;
    for (const name of run.viewNames()) {
      const b = await viewRun(ctx, 'base', name), p = await viewRun(ctx, 'page', name);
      if (b.skip || p.skip) { skipped.push(`${name} (${b.skip || p.skip})`); continue; }
      errors.push(...p.errors, ...b.errors.map((e) => 'base: ' + e));
      const d = diffPng(b.png, p.png, { out: path.join(ctx.dir, `${name}.diff.png`) });
      n++;
      if (d.max) bad.push(`${name}: ${fmtDiff(d)}`);
    }
    const ok = !bad.length && !errors.length;
    return { ok, msg: [ok ? `${n} views, max difference 0` : '', ...bad, ...errors, ...skipped.map((s) => 'skipped: ' + s)].filter(Boolean).join('\n') };
  },

  // No seam where the way flown wraps at 256 km. Pictures are compared tile by tile (8 x 8), so that a seam in
  // one part of the picture is not lost in the mean of the whole: two stills 2.8 m apart across the wrap differ
  // no more than two stills 2.8 m apart elsewhere, and a flight across the wrap matches stills along it no worse
  // than a flight elsewhere.
  async wrap(ctx) {
    const v = 'date=172&time=14&cloud=0.6&yaw=40&pitch=-14&heading=0';
    const f = (n) => path.join(ctx.dir, n + '.png');
    const pages = [];
    for (const [n, x, z] of [['s1', 255.999, 255.999], ['s2', 0.001, 0.001], ['c1', 100.999, 100.999], ['c2', 101.001, 101.001]]) {
      pages.push(await stillAt(ctx, ctx.page, `${v}&at=${x},${z}`, f(n)));
    }
    const across = diffPng(f('s1'), f('s2')), control = diffPng(f('c1'), f('c2'));
    const lines = [`stills across the wrap: worst tile ${across.tile}, ${fmtDiff(across)}; elsewhere: worst tile ${control.tile}, ${fmtDiff(control)}`];
    let ok = across.tile <= LIMITS.wrap(control.tile);
    // 27 frames at 900 km/h: 104 m, 4 m past the wrap; 61 frames: 240 m.
    const flown = {};
    for (const [n, z0] of [['across', 255.9], ['control', 100.9]]) {
      const p = await ctx.session.open(ctx.page, `${v}&speed=900&at=10,${z0}`, ctx.size);
      try {
        await p.step(27, 16);
        await p.shot(f(`${n}-27`));
        await p.step(34, 16);
        await p.shot(f(`${n}-61`));
        pages.push(p);
      } finally {
        await p.close();
      }
      for (const k of [27, 61]) {
        pages.push(await stillAt(ctx, ctx.page, `${v}&${at(reached(10, z0, 900, 0, k, 16))}`, f(`${n}-${k}-still`)));
        flown[`${n}-${k}`] = diffPng(f(`${n}-${k}-still`), f(`${n}-${k}`));
      }
    }
    for (const k of [27, 61]) {
      const a = flown[`across-${k}`], c = flown[`control-${k}`];
      lines.push(`frame ${k} of a flight against the still there: across worst tile ${a.tile}, mean ${a.mean}; elsewhere worst tile ${c.tile}, mean ${c.mean}`);
      ok = ok && a.tile <= LIMITS.wrap(c.tile);
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },

  // The loop: it stops at rest, and in a hidden tab, and starts again when the tab is shown.
  async loop(ctx) {
    const lines = [], pages = [];
    let ok = true;
    const expect = (cond, text) => { if (!cond) { ok = false; lines.push('not so: ' + text); } };
    const open = async (q) => { const p = await ctx.session.open(ctx.page, q, ctx.size); pages.push(p); return p; };
    const count = async (p) => { const d = (await p.draws()).sky; return d ? d.screen + d.offscreen : 0; };
    const hidden = (h) => `(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${h} });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${h} ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange')); return 0; })()`;
    const pending = (p) => p.eval('window.__pending()');
    try {
      let p = await open('speed=0');
      await p.step(60, 16);
      const r1 = await count(p);
      await p.step(60, 16);
      const r2 = await count(p), rq = await pending(p);
      lines.push(`at rest: draws ${r1} after 60 frames, ${r2} after 120; ${rq} frames queued`);
      expect(r1 > 0 && r2 === r1 && rq === 0, 'the drawing stops at rest');

      p = await open('');
      await p.step(10, 16);
      const h1 = await count(p);
      await p.eval(hidden(true));
      await p.step(10, 16);
      const h2 = await count(p), hq = await pending(p);
      await p.eval(hidden(false));
      await p.step(10, 16);
      const h3 = await count(p);
      lines.push(`flying, hidden, visible: draws ${h1}, ${h2}, ${h3}; ${hq} frames queued while hidden`);
      expect(h1 > 0 && h2 === h1 && hq === 0, 'nothing is drawn in a hidden tab');
      expect(h3 > h2, 'drawing starts again when the tab is shown');
    } finally {
      for (const p of pages) await p.close();
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },

  // No jump when the drawing size changes. (1) ?res=0.5: fly at half size, stop: the picture grows to full size,
  // and neither the stop nor the growth shifts it against a still at that place. (2) Without res: slow frames
  // make the picture smaller in flight, fast frames let it grow back.
  async res(ctx) {
    const v = 'date=172&time=14&cloud=0.6&yaw=40&pitch=-14&heading=0';
    const f = (n) => path.join(ctx.dir, n + '.png');
    const lines = [], pages = [];
    let ok = true;
    const expect = (cond, text) => { if (!cond) { ok = false; lines.push('not so: ' + text); } };
    const stop = "(() => { const s = document.getElementById('speed'); s.value = 0; s.dispatchEvent(new Event('input')); return 0; })()";
    const p = await ctx.session.open(ctx.page, `${v}&speed=900&at=10,60&res=0.5`, ctx.size);
    pages.push(p);
    const sizes = {};
    try {
      const plan = [['fly', 61], ['stop', 5], ['grown1', 6], ['grown5', 4], ['settled', 60]];
      for (const [name, n] of plan) {
        if (name === 'stop') await p.eval(stop);
        await p.step(n, 16);
        await p.shot(f(name));
        sizes[name] = (await p.draws()).sky.size;
      }
    } finally {
      await p.close();
    }
    // The frame that reads the slider still flies: 61 frames of flight after the first.
    const z = 60 + KMS(900) * 61 * 0.016;
    pages.push(await stillAt(ctx, ctx.page, `${v}&at=10,${z.toFixed(6)}`, f('still')));
    const still = readPng(f('still'));
    const box = [Math.round(still.w * 0.15), Math.round(still.h * 0.35), Math.round(still.w * 0.7), Math.round(still.h * 0.5)];
    for (const name of ['fly', 'stop', 'grown1', 'grown5', 'settled']) {
      const s = shiftOf(still, f(name), box), d = diffPng(still, f(name));
      lines.push(`${name}: drawn at ${sizes[name]}, shift against the still ${s.join(',')} px, ${fmtDiff(d)}`);
      expect(s[0] === 0 && s[1] === 0, `${name}: no shift`);
    }
    expect(sizes.fly !== sizes.settled, 'res=0.5 draws smaller in flight');
    expect(sizes.grown1 === sizes.settled && sizes.settled.startsWith(still.w + 'x'), 'the picture is full size soon after the stop');
    expect(diffPng(still, f('settled')).mean <= LIMITS.settled[ctx.renderer], `the settled picture is within ${LIMITS.settled[ctx.renderer]} of the still`);

    // (2) Frames of 60 ms are too slow for 25 per second: the picture shrinks; frames of 16 ms let it grow back.
    const q = await ctx.session.open(ctx.page, `${v}&speed=900&at=10,60`, ctx.size);
    pages.push(q);
    try {
      await q.step(30, 16);
      const a = (await q.draws()).sky.size;
      await q.step(16, 60);
      const b = (await q.draws()).sky.size;
      await q.step(110, 16);
      const c = (await q.draws()).sky.size;
      lines.push(`frame time sets the size: ${a} at 16 ms, ${b} after slow frames, ${c} after fast ones again`);
      const px = (s) => s.split('x').reduce((x, y) => x * y);
      expect(px(b) < px(a) && c === a, 'slow frames shrink the picture and fast ones restore it');
    } finally {
      await q.close();
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },

  // A flight against a settled still at the place reached: the moving picture keeps close to the still one.
  // The limits are per renderer; with a base, the page must also do no worse than the base.
  async flight(ctx) {
    const flights = [
      { name: 'cruise', q: 'date=172&time=15&yaw=20&pitch=-12', frames: 61 },
      { name: 'low', q: 'date=172&time=14&alt=3&pitch=-5&yaw=60', frames: 61 },
    ];
    const f = (n) => path.join(ctx.dir, n + '.png');
    const lines = [], pages = [];
    let ok = true;
    const measure = async (root, who) => {
      const out = {};
      for (const fl of flights) {
        const fly = f(`${fl.name}.${who}`), still = f(`${fl.name}-still.${who}`);
        pages.push(await shoot(ctx, root, `${fl.q}&speed=900&heading=0&at=40,60`, [[fl.frames, 16]], fly));
        pages.push(await stillAt(ctx, root, `${fl.q}&heading=0&${at(reached(40, 60, 900, 0, fl.frames, 16))}`, still));
        out[fl.name] = diffPng(still, fly, { out: f(`${fl.name}-diff.${who}`) });
      }
      return out;
    };
    const page = await measure(ctx.page, 'page'), base = ctx.base ? await measure(ctx.base, 'base') : null;
    for (const fl of flights) {
      const d = page[fl.name], limit = LIMITS.flight[ctx.renderer][fl.name];
      const rel = base ? LIMITS.flightBase(base[fl.name].mean) : Infinity;
      lines.push(`${fl.name}: ${fl.frames} frames flown against the still: ${fmtDiff(d)} (limit ${limit}` +
        (base ? `; base ${base[fl.name].mean}, limit ${rel.toFixed(3)})` : ')'));
      if (d.mean > limit || d.mean > rel) ok = false;
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },
};

// Limits, from the numbers measured on main and on broken copies (see tools/README.md), with room for noise.
const LIMITS = {
  wrap: (control) => control * 1.5 + 1,
  // 0.9: at rest the exposure stops within ADAPT_STOP of the meter's target and moves again only beyond
  // ADAPT_START, so a picture settled after a flight may sit some 0.02 stops off the still's (0.84 at #31).
  settled: { gpu: 0.9, swiftshader: 0.9 },
  // cruise 1.8: the exposure follows a meter of the picture, which in flight holds fewer frames; it ends about
  // 0.02 stops off the settled still's, a uniform 0.8 levels (1.62 at #31; 1.13 before the meter).
  flight: { gpu: { cruise: 1.8, low: 1.6 }, swiftshader: { cruise: 1.8, low: 1.9 } },
  flightBase: (base) => base * 1.1 + 0.03,
};

export async function runChecks(session, { names, page, base, size, gpu, dir, ignore }) {
  const list = names.length ? names : Object.keys(CHECKS);
  for (const n of list) if (!CHECKS[n]) throw new Error(`no check ${n} (${Object.keys(CHECKS).join(', ')})`);
  const t0 = Date.now(), runs = new Map();
  let failed = 0, skipped = 0;
  console.log(`page ${page}${base ? `, base ${base}` : ''}, ${size.w}x${size.h}, ${gpu ? 'GPU' : 'SwiftShader'}`);
  for (const name of list) {
    const t = Date.now();
    const sub = path.join(dir, name);
    fs.mkdirSync(sub, { recursive: true });
    let r;
    try {
      r = await CHECKS[name]({ session, page, base, size, dir: sub, out: dir, ignore, runs, renderer: gpu ? 'gpu' : 'swiftshader' });
    } catch (err) {
      r = { ok: false, msg: err.stack || String(err) };
    }
    const secs = ((Date.now() - t) / 1000).toFixed(0);
    if (r.skip) { skipped++; console.log(`SKIP ${name}: ${r.skip}`); continue; }
    if (!r.ok) failed++;
    const [first, ...more] = r.msg.split('\n');
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name} (${secs} s): ${first}`);
    for (const l of more) console.log('     ' + l);
  }
  const ran = list.length - skipped;
  console.log(`${failed ? 'FAIL' : 'PASS'}: ${ran - failed} of ${ran} checks passed${skipped ? `, ${skipped} skipped` : ''}, ${((Date.now() - t0) / 1000).toFixed(0)} s; pictures in ${dir}`);
  return failed === 0;
}
