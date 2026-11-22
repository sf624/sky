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

// The flight of the page's `fly` (index.html, Steering), frame by frame, at a fixed bank and climb with no control
// held but the rudder (-1 to 1): from (x, z) and heading (degrees), frames frames of ms each (the first does not
// move). Returns the place and the heading reached. Written apart from the page, to test it.
const G = 9.81e-3, TURN_MAX = 30, YAW_RATE = 3;
const flownPath = ({ x, z, heading, bank = 0, climb = 0, rudder = 0, kmh, frames, ms }) => {
  const R = Math.PI / 180, v = KMS(kmh), dt = ms / 1000, w = (u) => ((u % WEATHER_KM) + WEATHER_KM) % WEATHER_KM;
  const rate = Math.max(-TURN_MAX * R, Math.min(TURN_MAX * R, (v > 0 && bank ? G * Math.tan(bank * R) / v : 0) + rudder * YAW_RATE * R));
  let h = heading * R;
  for (let k = 1; k < frames; k++) {
    const was = h, step = v * dt * Math.cos(climb * R);
    h += rate * dt;
    x = w(x + step * Math.sin((was + h) / 2));
    z = w(z + step * Math.cos((was + h) / 2));
  }
  return { at: [x, z], heading: h / R };
};
// The distance of two places on the map, km, across its wrap.
const apart = (a, b) => Math.hypot(...[0, 1].map((i) => ((a[i] - b[i] + 1.5 * WEATHER_KM) % WEATHER_KM) - 0.5 * WEATHER_KM));
// A view of the page's flight now (window.__flight()) as a query: a still there, at rest.
const flightQuery = (fl) => `heading=${fl.heading}&yaw=${fl.yaw}&pitch=${fl.pitch}&bank=${fl.bank}&climb=${fl.climb}&at=${fl.at[0]},${fl.at[1]}`;
// Where the camera cam (column-major: right, up, forward) puts the direction s on a picture w by h (pixels from
// the top left; the page's vertical field of view is 62 degrees), or null behind the eye.
const onScreen = (cam, s, w, h) => {
  const d = (c) => cam[c] * s[0] + cam[c + 1] * s[1] + cam[c + 2] * s[2], t = Math.tan(31 * Math.PI / 180);
  const f = d(6);
  return f > 0 ? [(d(0) / f / t * h + w) / 2, h - (d(3) / f / t * h + h) / 2] : null;
};
// The middle of the sun's disc in a picture: the centroid of the white pixels within r of near.
const sunIn = (img, near, r = 60) => {
  let n = 0, sx = 0, sy = 0;
  for (let y = Math.max(0, Math.round(near[1] - r)); y < Math.min(img.h, near[1] + r); y++) {
    for (let x = Math.max(0, Math.round(near[0] - r)); x < Math.min(img.w, near[0] + r); x++) {
      const i = 3 * (y * img.w + x);
      if (Math.min(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]) >= 252) { n++; sx += x + 0.5; sy += y + 0.5; }
    }
  }
  return n ? [sx / n, sy / n] : null;
};
// Detail: the mean difference of neighbouring pixels (grey levels) inside box, a measure of sharpness. With the
// camera cam (column-major: right, up, forward), rolled about its eye's axis, the box is the one of the same
// camera unrolled, turned with the picture: the same part of the view. (A fixed box saw the near clouds of a
// banked view and the far ones of a level view.)
const detailOf = (img, [x0, y0, bw, bh], cam = null) => {
  let sum = 0, n = 0;
  const g = (x, y) => { const i = 3 * (y * img.w + x); return img.rgb[i] + img.rgb[i + 1] + img.rgb[i + 2]; };
  // The roll: the right axis leaves the horizontal plane by sin(roll) times the cosine of the eye's pitch.
  const r = cam ? Math.asin(Math.max(-1, Math.min(1, cam[1] / Math.hypot(cam[6], cam[8])))) : 0;
  const c = Math.cos(r), s = Math.sin(r), cx = img.w / 2, cy = img.h / 2;
  for (let y = 0; y < img.h - 1; y++) {
    for (let x = 0; x < img.w - 1; x++) {
      const u = cx + (x - cx) * c + (y - cy) * s, v = cy - (x - cx) * s + (y - cy) * c;
      if (u < x0 || u >= x0 + bw - 1 || v < y0 || v >= y0 + bh - 1) continue;
      sum += Math.abs(g(x + 1, y) - g(x, y)) + Math.abs(g(x, y + 1) - g(x, y)); n++;
    }
  }
  return sum / n / 3;
};
// The horizon in a picture, from the row of the strongest step of brightness in each column of the middle half,
// near the line expected (y = y0 + slope * x): its angle (degrees, counter-clockwise positive) and its row at x.
const horizonLine = (img, y0, slope, r = 40) => {
  const L = (x, y) => { const i = 3 * (y * img.w + x); return img.rgb[i] + img.rgb[i + 1] + img.rgb[i + 2]; };
  const xs = [], ys = [];
  for (let x = Math.round(img.w / 4); x < img.w * 3 / 4; x += 4) {
    const c = y0 + slope * x;
    let best = -1, at = -1;
    for (let y = Math.max(1, Math.round(c - r)); y < Math.min(img.h - 1, c + r); y++) {
      const s = Math.abs(L(x, y + 1) - L(x, y - 1));
      if (s > best) { best = s; at = y; }
    }
    if (at >= 0) { xs.push(x); ys.push(at); }
  }
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const k = sxy / sxx;
  return { angle: -Math.atan(k) * 180 / Math.PI, at: (x) => my + k * (x - mx) };
};
const horizonIn = (img, y0, slope, r = 40) => horizonLine(img, y0, slope, r).angle;
// The line of the HUD's green in a picture near the line expected (y = y0 + slope * x, CSS px; dpr device pixels
// a CSS px), over the columns xs (CSS px): the green-weighted mean row of each column within r device pixels, and
// the line through them, as horizonLine. The dark edge of the HUD's lines is not green.
const greenLine = (img, y0, slope, xs, dpr = 1, r = 6) => {
  const X = [], Y = [];
  for (const cx of xs) {
    const x = Math.round(cx * dpr), c = (y0 + slope * cx) * dpr;
    let n = 0, sy = 0;
    for (let y = Math.max(0, Math.round(c - r)); y <= Math.min(img.h - 1, c + r); y++) {
      const i = 3 * (y * img.w + x), g = img.rgb[i + 1] - Math.max(img.rgb[i], img.rgb[i + 2]);
      if (g > 40) { n += g; sy += g * (y + 0.5); }
    }
    if (n) { X.push(x / dpr); Y.push(sy / n / dpr); }
  }
  const mx = X.reduce((a, b) => a + b, 0) / X.length, my = Y.reduce((a, b) => a + b, 0) / Y.length;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; }
  const k = sxy / sxx;
  return { n: X.length, at: (x) => my + k * (x - mx) };
};
const errorsOf = (pages) => pages.flatMap((p) => p.errors);
// The exposure (log2) of the page's last frame, or null where the page has no `window.__exposure` (the base, which
// has no meter) or has not set it yet; and the query that pins a page at it (`?expo=`; nothing where null).
const exposureOf = async (p) => { const e = await p.eval('window.__exposure'); return typeof e === 'number' ? e : null; };
const pinned = (e) => (e === null ? '' : `&expo=${e}`);

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
  // make the picture smaller in flight, fast frames let it grow back (at high; at max it keeps its size).
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
    let expo = null;
    try {
      const plan = [['fly', 61], ['stop', 5], ['grown1', 6], ['grown5', 4], ['settled', 60]];
      for (const [name, n] of plan) {
        if (name === 'stop') await p.eval(stop);
        await p.step(n, 16);
        await p.shot(f(name));
        sizes[name] = (await p.draws()).sky.size;
      }
      expo = await exposureOf(p);   // the still is drawn at the settled picture's exposure (see flight)
    } finally {
      await p.close();
    }
    // The frame that reads the slider still flies: 61 frames of flight after the first.
    const z = 60 + KMS(900) * 61 * 0.016;
    pages.push(await stillAt(ctx, ctx.page, `${v}&at=10,${z.toFixed(6)}${pinned(expo)}`, f('still')));
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
    // So at high; at max the picture keeps the canvas's size whatever the frame time.
    const px = (s) => s.split('x').reduce((x, y) => x * y);
    for (const level of ['high', 'max']) {
      const q = await ctx.session.open(ctx.page, `${v}&speed=900&at=10,60&quality=${level}`, ctx.size);
      pages.push(q);
      try {
        await q.step(30, 16);
        const a = (await q.draws()).sky.size;
        await q.step(16, 60);
        const b = (await q.draws()).sky.size;
        await q.step(110, 16);
        const c = (await q.draws()).sky.size;
        lines.push(`${level}: frame time sets the size: ${a} at 16 ms, ${b} after slow frames, ${c} after fast ones again`);
        if (level === 'max') expect(b === a && c === a, 'max keeps the canvas\'s size whatever the frame time');
        else expect(px(b) < px(a) && c === a, 'slow frames shrink the picture and fast ones restore it');
      } finally {
        await q.close();
      }
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
    // The flight's exposure at its last frame sets the still's (`?expo=`), so that both are drawn at the same
    // exposure: each follows a meter of its own (the still settles at rest, within a hysteresis, the flight
    // tracks), and they end a hair apart, which the comparison would count as a difference of the picture.
    // Where the page has no such exposure (main), the still is drawn as it comes. The flight's exposure over its
    // last LIMITS.steady.frames frames gives the steadiness: its range, in stops.
    const measure = async (root, who) => {
      const out = {};
      for (const fl of flights) {
        const fly = f(`${fl.name}.${who}`), still = f(`${fl.name}-still.${who}`);
        const p = await ctx.session.open(root, `${fl.q}&speed=900&heading=0&at=40,60`, ctx.size);
        let e = null;
        const seen = [];
        try {
          await p.step(fl.frames - LIMITS.steady.frames, 16);
          for (let i = 0; i < LIMITS.steady.frames; i++) {
            await p.step(1, 16);
            seen.push(await exposureOf(p));
          }
          e = seen[seen.length - 1];
          await p.shot(fly);
          pages.push(p);
        } finally {
          await p.close();
        }
        pages.push(await stillAt(ctx, root, `${fl.q}&heading=0&${at(reached(40, 60, 900, 0, fl.frames, 16))}${pinned(e)}`, still));
        out[fl.name] = { ...diffPng(still, fly, { out: f(`${fl.name}-diff.${who}`) }), expo: e,
          range: e === null ? null : Math.max(...seen) - Math.min(...seen) };
      }
      return out;
    };
    const page = await measure(ctx.page, 'page'), base = ctx.base ? await measure(ctx.base, 'base') : null;
    for (const fl of flights) {
      const d = page[fl.name], limit = LIMITS.flight[ctx.renderer][fl.name];
      const rel = base ? LIMITS.flightBase(base[fl.name].mean) : Infinity;
      lines.push(`${fl.name}: ${fl.frames} frames flown against the still${d.expo === null ? '' : ` at exposure ${d.expo.toFixed(4)}`}: ` +
        `${fmtDiff(d)} (limit ${limit}` + (base ? `; base ${base[fl.name].mean}, limit ${rel.toFixed(3)})` : ')'));
      if (d.mean > limit || d.mean > rel) ok = false;
      if (d.range !== null) {
        lines.push(`${fl.name}: exposure over the last ${LIMITS.steady.frames} frames moves ${d.range.toFixed(4)} stops (limit ${LIMITS.steady.range})`);
        if (d.range > LIMITS.steady.range) ok = false;
      }
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },

  // Steering (index.html, Steering). (a) Flights along headings 0, 90, 180 and 270, a banked turn and a whole
  // circle reach the place and the heading that the turn's own sum (flownPath) gives, and their last frame matches
  // a still drawn directly there (heading, eye, bank) within the flight check's limit. (b) A banked flight on a
  // diagonal across the wrap matches its still no worse than one elsewhere (as wrap). (c) In the banked turn the
  // flown frame keeps the detail of a level flight (against their stills). (d) The sun stays put in the world: a
  // turn of the heading by the rudder key, and a bank by the bank key, move it on the screen where the camera says.
  // (e) A bank tilts the sea's horizon by the bank, looking ahead; the stills at bank 0, 30 and 60 are for looking
  // at. (f) A climb. (g) The HUD's glass, fixed to the airframe, agrees with the camera and the picture;
  // looking out of the side, only the helmet's readouts are drawn.
  async steer(ctx) {
    const f = (n) => path.join(ctx.dir, n + '.png');
    const lines = [], pages = [];
    let ok = true;
    const expect = (cond, text) => { if (!cond) { ok = false; lines.push('not so: ' + text); } };
    const flightNow = (p) => p.eval('window.__flight()');
    // Flies q for n frames of ms; shoots the last frame (and the one before, for looking at ghosts).
    const fly = async (name, q, n, ms, two = false, before = '') => {
      const p = await ctx.session.open(ctx.page, q, ctx.size);
      try {
        if (before) await p.eval(`${before}, 0`);
        await p.step(n - (two ? 1 : 0), ms);
        if (two) { await p.shot(f(`${name}-before`)); await p.step(1, ms); }
        const fl = await flightNow(p), e = await exposureOf(p);
        await p.shot(f(name));
        pages.push(p);
        return { fl, e };
      } finally {
        await p.close();
      }
    };
    const stillThere = async (name, base, fl, e) => pages.push(await stillAt(ctx, ctx.page, `${base}&${flightQuery(fl)}${pinned(e)}`, f(`${name}-still`)));
    const limit = LIMITS.flight[ctx.renderer].cruise;
    const base = 'date=172&time=15&pitch=-12&cirrus=0.4';
    const box = (img) => [Math.round(img.w * 0.1), Math.round(img.h * 0.55), Math.round(img.w * 0.8), Math.round(img.h * 0.4)];
    // A settled still of q at rest: its exposure and the page's flight.
    const settled = async (q) => {
      const p = await ctx.session.open(ctx.page, run.stillQuery(q), ctx.size);
      try {
        await p.step(run.view('default').frames, 50);
        const r = { e: await exposureOf(p), fl: await flightNow(p) };
        pages.push(p);
        return r;
      } finally {
        await p.close();
      }
    };
    // The turns are flown at the exposure of their first view, held (`?expo=`), and so are their stills: while
    // the view turns past the sun the meter moves (0.14 stops in the last 20 frames of the circle), and the mean
    // over frames, which lags it, would count as a difference of the picture.
    // (At a place among heaps: the detail kept is the clouds'. At 40,60, since #113 a clear lane between clusters,
    // it was the sea's glitter's, which a banked view keeps less of.)
    const turn = 'date=172&time=15&cirrus=0.4&heading=30&yaw=50&pitch=-12&bank=45&at=0,0';
    const t0 = await settled(turn);
    // The control of the turn: the same first view, level (the eye's direction of the banked camera, no roll),
    // turned by the rudder at the same rate (700 km/h at 45 degrees: 2.9 degrees a second; the rudder's 3).
    const fwd = t0.fl.cam.slice(6, 9), deg = 180 / Math.PI;
    const level = `date=172&time=15&cirrus=0.4&heading=30&yaw=${Math.atan2(fwd[0], fwd[2]) * deg}&pitch=${Math.asin(fwd[1]) * deg}&at=0,0`;
    const circle = 'date=172&time=15&cirrus=0.4&heading=0&yaw=20&pitch=-12&bank=60&at=40,60';
    const c0 = await settled(circle);
    // (a) and (c).
    const flights = [
      ...[0, 90, 180, 270].map((hd) => ({ name: `heading-${hd}`, q: `${base}&heading=${hd}&yaw=${hd + 20}&at=40,60`, hd, kmh: 900, frames: 61, ms: 16 })),
      { name: 'turn-45', q: `${turn}&expo=${t0.e}`, from: [0, 0], hd: 30, bank: 45, kmh: 700, frames: 121, ms: 16, two: true, e: t0.e },
      { name: 'rudder', q: `${level}&expo=${t0.e}`, from: [0, 0], hd: 30, rudder: 1, kmh: 700, frames: 121, ms: 16, e: t0.e,
        before: "window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }))" },
      // A whole circle: 200 km/h at 60 degrees turns at 17.5 degrees a second.
      { name: 'circle', q: `${circle}&expo=${c0.e}`, hd: 0, bank: 60, kmh: 200, ms: 32, e: c0.e,
        frames: 1 + Math.round(2 * Math.PI / (G * Math.tan(Math.PI / 3) / KMS(200)) / 0.032) },
    ];
    const result = {};
    for (const fl of flights) {
      const { fl: got, e } = await fly(fl.name, `${fl.q}&speed=${fl.kmh}`, fl.frames, fl.ms, fl.two, fl.before);
      const want = flownPath({ x: fl.from ? fl.from[0] : 40, z: fl.from ? fl.from[1] : 60, heading: fl.hd, bank: fl.bank, rudder: fl.rudder, kmh: fl.kmh, frames: fl.frames, ms: fl.ms });
      await stillThere(fl.name, 'date=172&time=15&cirrus=0.4', got, fl.e ?? e);
      const d = diffPng(f(`${fl.name}-still`), f(fl.name), { out: f(`${fl.name}-diff`) });
      const sa = readPng(f(`${fl.name}-still`)), fa = readPng(f(fl.name));
      const sharp = detailOf(fa, box(fa), got.cam) / detailOf(sa, box(sa), got.cam);
      result[fl.name] = { d, sharp };
      const miss = apart(got.at, want.at) * 1e6, turned = got.heading - fl.hd;
      lines.push(`${fl.name}: heading ${fl.hd} -> ${got.heading.toFixed(3)} (sum ${want.heading.toFixed(3)}), place off the sum by ${miss.toFixed(1)} mm` +
        `${fl.name === 'circle' ? `, ${(apart(got.at, [40, 60]) * 1000).toFixed(1)} m from the start after turning ${turned.toFixed(2)} degrees` : ''}; ` +
        `against the still ${fmtDiff(d)}; detail ${sharp.toFixed(3)} of the still's`);
      expect(miss < 1 && Math.abs(got.heading - want.heading) < 1e-6, `${fl.name}: the place and heading of the sum`);
      if (fl.name.startsWith('heading-') || fl.name === 'circle') expect(d.mean <= limit, `${fl.name}: within ${limit} of the still`);
      if (fl.name === 'circle') expect(Math.abs(turned - 360) < 0.6 && apart(got.at, [40, 60]) < 0.01, 'the circle closes');
    }
    // The bank adds nothing to a turn's own cost: against the level turn over the same view, the banked one is
    // as close to its still and as sharp (its detail measured over the same part of the view, see detailOf). (Any turn, a drag of the view too, keeps less detail than a straight
    // flight: about 0.90 of the still's, against 0.96 to 0.99.)
    const tb = result['turn-45'], tr = result.rudder;
    expect(tb.d.mean <= LIMITS.turn(tr.d.mean), `the banked turn within ${LIMITS.turn(tr.d.mean).toFixed(3)} of its still (the level turn's ${tr.d.mean}, times 1.15, plus 0.1)`);
    expect(tb.sharp >= tr.sharp - 0.03, `the banked turn keeps the level turn's detail (${tr.sharp.toFixed(3)}, less 0.03)`);

    // (b) Across the wrap on a diagonal, in a turn, against a flight elsewhere.
    const wrapped = {};
    for (const [n, z0] of [['wrap-across', 255.92], ['wrap-control', 100.92]]) {
      const q = `date=172&time=14&cloud=0.6&yaw=85&pitch=-14&heading=45&bank=20&speed=900`;
      const { fl: got, e } = await fly(n, `${q}&at=${z0},${z0}`, 61, 16);
      await stillThere(n, 'date=172&time=14&cloud=0.6', got, e);
      wrapped[n] = { d: diffPng(f(`${n}-still`), f(n)), at: got.at };
    }
    const wa = wrapped['wrap-across'], wc = wrapped['wrap-control'];
    lines.push(`diagonal across the wrap (to ${wa.at.map((v) => v.toFixed(4)).join(',')}): worst tile ${wa.d.tile}, mean ${wa.d.mean}; elsewhere worst tile ${wc.d.tile}, mean ${wc.d.mean}`);
    expect(wa.at[0] < 1 && wa.at[1] < 1, 'the diagonal flight crosses the wrap on both axes');
    expect(wa.d.tile <= LIMITS.wrap(wc.d.tile), 'no seam across the wrap');

    // (d) The sun, in a view towards it at a low sun: first where it is, then the rudder (E, held for 6.7 s at
    // rest) turns the heading by about 20 degrees (the eye turns along), then the bank key (D, 1 s) banks 30.
    {
      const q0 = 'date=172&time=17.6&cloud=0.3&cirrus=0&speed=0&heading=0';
      const p0 = await ctx.session.open(ctx.page, q0, ctx.size);
      let sun;
      try { await p0.step(2, 50); sun = (await flightNow(p0)).sun; pages.push(p0); } finally { await p0.close(); }
      const syaw = Math.atan2(sun[0], sun[2]) * 180 / Math.PI, sel = Math.asin(sun[1]) * 180 / Math.PI;
      const p = await ctx.session.open(ctx.page, `${q0}&yaw=${syaw - 15}&pitch=${sel}`, ctx.size);
      // Holds a key for n frames of 100 ms (the first frame after the press has no time: the frames had stopped).
      const hold = async (code, n) => {
        await p.eval(`(window.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}' })), 0)`);
        await p.step(n + 1, 100);
        await p.eval(`(window.dispatchEvent(new KeyboardEvent('keyup', { code: '${code}' })), 0)`);
      };
      try {
        const steps = [['sun-0', null], ['sun-turned', () => hold('KeyE', 67)], ['sun-banked', () => hold('KeyD', 10)]];
        for (const [n, act] of steps) {
          if (act) await act();
          await p.step(run.view('default').frames, 50);
          await p.shot(f(n));
          const fl = await flightNow(p), img = readPng(f(n));
          const want = onScreen(fl.cam, fl.sun, img.w, img.h), got = want && sunIn(img, want);
          const off = got ? Math.hypot(got[0] - want[0], got[1] - want[1]) : Infinity;
          const moved = Math.hypot(...fl.sun.map((c, i) => c - sun[i]));
          lines.push(`${n}: heading ${fl.heading.toFixed(2)}, bank ${fl.bank}: the sun expected at ${want ? want.map((v) => v.toFixed(1)).join(',') : 'behind'}, ` +
            `found at ${got ? got.map((v) => v.toFixed(1)).join(',') : 'nowhere'} (${off.toFixed(2)} px); its direction moved by ${moved.toExponential(1)}`);
          expect(off < 3 && moved < 1e-9, `${n}: the sun where the camera puts it, fixed in the world`);
        }
        pages.push(p);
      } finally {
        await p.close();
      }
    }

    // (f) A climb of 5 degrees at 900 km/h from 3 km: the altitude reached is the sum's, and the last frame
    // matches the picture there once the aircraft has stopped and the picture settled (the altitude cannot be
    // given exactly in the address: its slider rounds it). Then a climb into the top of the range levels off.
    {
      const p = await ctx.session.open(ctx.page, 'date=172&time=14&alt=3&pitch=-5&yaw=60&heading=0&climb=5&speed=900&at=40,60', ctx.size);
      const stop = "(() => { const s = document.getElementById('speed'); s.value = 0; s.dispatchEvent(new Event('input')); return 0; })()";
      try {
        await p.step(61, 16);
        const fl = await flightNow(p);
        await p.shot(f('climb'));
        await p.eval(stop);
        await p.step(run.view('default').frames, 50);
        const rest = await flightNow(p);
        await p.shot(f('climb-still'));
        pages.push(p);
        const want = 3 + 60 * KMS(900) * 0.016 * Math.sin(5 * Math.PI / 180);
        const d = diffPng(f('climb-still'), f('climb'), { out: f('climb-diff') });
        lines.push(`climb: altitude ${fl.alt.toFixed(6)} km (sum ${want.toFixed(6)}), at rest ${rest.alt.toFixed(6)} km, ${(apart(fl.at, rest.at) * 1e6).toFixed(1)} mm on; ` +
          `against the settled picture ${fmtDiff(d)} (limit ${LIMITS.flight[ctx.renderer].low})`);
        expect(Math.abs(fl.alt - want) < 1e-6 && rest.alt === fl.alt, 'climb: the altitude of the sum, kept at rest');
        expect(d.mean <= LIMITS.flight[ctx.renderer].low, 'climb: within the flight limit of the settled picture');
      } finally {
        await p.close();
      }
      // The altitude has one path (setAltitude): through 13 km, where the slider's scale changes, and to both limits
      // (0.3 and 40 km) the slider's place and the field agree with the state, and with a page opened at that altitude.
      const sliderNow = (p) => p.eval("[+document.getElementById('alt').value, document.getElementById('altOut').value]");
      for (const [name, start, climb, frames, want] of [['through 13 km', 12.95, 10, 120, null], ['down through 13 km', 13.05, -10, 120, null],
        ['to the top', 39.9, 10, 400, 40], ['to the bottom', 0.4, -10, 400, 0.3]]) {
        const q = await ctx.session.open(ctx.page, `date=172&time=14&alt=${start}&heading=0&climb=${climb}&speed=900&at=40,60`, ctx.size);
        let fl, sl;
        try {
          await q.step(frames, 16);
          fl = await flightNow(q);
          sl = await sliderNow(q);
          pages.push(q);
        } finally {
          await q.close();
        }
        const r = await ctx.session.open(ctx.page, `date=172&time=14&alt=${fl.alt}&speed=0`, ctx.size);
        let ref;
        try {
          await r.step(2, 16);
          ref = await sliderNow(r);
          pages.push(r);
        } finally {
          await r.close();
        }
        lines.push(`climb ${name}: altitude ${fl.alt} km, climb ${fl.climb.toFixed(3)} degrees, slider ${sl[0]} (${sl[1]}), a page opened there: ${ref[0]} (${ref[1]})`);
        expect(want === null ? (start < 13) === (fl.alt > 13) : fl.alt === want && fl.climb === 0, `climb ${name}: the altitude ${want === null ? 'passes 13 km' : 'levels off at ' + want + ' km'}`);
        expect(sl[0] === ref[0] && sl[1] === ref[1], `climb ${name}: the slider and the field agree with the altitude`);
      }
    }

    // (e) The horizon at 0.3 km, clear, looking ahead: tilted by the bank (counter-clockwise for a bank to the
    // right). And stills at bank 0, 30, 60 at a low sun at 11 km, for looking at; their exposures.
    for (const b of [0, 30, 60]) {
      const n = `horizon-${b}`;
      const fl = { heading: 100, yaw: 100, pitch: 0, bank: b, climb: 0, at: [40, 60] };
      pages.push(await stillAt(ctx, ctx.page, `date=172&time=11&alt=0.3&cloud=0&cirrus=0&${flightQuery(fl)}`, f(n)));
      const img = readPng(f(n));
      // The sea's horizon dips 0.56 degrees at 0.3 km: from the middle of the picture, rotated by the bank.
      const t = Math.tan(31 * Math.PI / 180), dip = Math.tan(0.56 * Math.PI / 180) / t * img.h / 2, r = b * Math.PI / 180;
      const slope = -Math.tan(r), y0 = img.h / 2 + dip / Math.cos(r) - slope * img.w / 2;
      const angle = horizonIn(img, y0, slope);
      lines.push(`${n}: the horizon at ${angle.toFixed(2)} degrees (expected ${b})`);
      expect(Math.abs(angle - b) < 1, `${n}: the horizon tilted by the bank`);
      const m = `banked-${b}`;
      const fm = { heading: 0, yaw: 60, pitch: -6, bank: b, climb: 0, at: [40, 60] };
      const pm = await stillAt(ctx, ctx.page, `date=172&time=17.4&cloud=0.5&${flightQuery(fm)}`, f(m));
      pages.push(pm);
    }
    // (g) The HUD (?hud=1), a glass fixed to the airframe, agrees with the camera and with the picture. In views
    // ahead, aside, up and down, banked and climbing (one on a phone's profile, 411x781 at a ratio of 2.625): its
    // anchor (window.__hud()) is where the camera puts the nose, within 1 px; its horizon line lies on the camera's
    // plane of zero pitch (the line through the projections of two level directions) within 1 px at both edges of
    // the picture, and so does the green line drawn (found in the picture, at the device's pixels, along the
    // horizon beside the marker). Looking ahead at 0.3 km over a clear sea, the sea's horizon in a still without the
    // HUD lies below the HUD's line by the dip of the altitude (0.56 degrees) within 2 px. The flight path marker
    // drawn (the middle of its green) is at the anchor within 1 px, looking ahead and with the eye 20 degrees to the
    // right, where it has moved by the camera's shift of the nose. In each of these views the glass is in view
    // (window.__hud().airframe). Looking 90 degrees aside it is not, and the HUD's canvas holds the helmet's readouts
    // alone: pixels are painted, and none outside the readouts' zones (window.__hud().helmet).
    {
      const R = Math.PI / 180;
      const states = [
        ['ahead', { heading: 100, yaw: 100, pitch: 0, bank: 0, climb: 0 }, { sea: true }],
        ['ahead-30-5', { heading: 100, yaw: 100, pitch: 0, bank: 30, climb: 5 }, { sea: true }],
        ['ahead-m45', { heading: 100, yaw: 100, pitch: 0, bank: -45, climb: 0 }, { sea: true }],
        ['up-m45-m5', { heading: 100, yaw: 110, pitch: 8, bank: -45, climb: -5 }, {}],
        ['marker-ahead', { heading: 100, yaw: 100, pitch: 0, bank: 0, climb: 3 }, { marker: true }],
        ['marker-right-20', { heading: 100, yaw: 120, pitch: 0, bank: 0, climb: 3 }, { marker: true }],
        ['side-90', { heading: 100, yaw: 190, pitch: -8, bank: 20, climb: 0 }, { empty: true }],
        ['phone-30-5', { heading: 100, yaw: 100, pitch: 0, bank: 30, climb: 5 }, { size: { w: 411, h: 781, dpr: 2.625, mobile: true } }],
      ];
      const sea = 'date=172&time=11&alt=0.3&cloud=0&cirrus=0';
      // The pixels painted on the HUD's canvas, and those of them outside the helmet's zones.
      const painted = "(() => { const c = document.querySelector('.hud'), h = window.__hud(); if (!c.width || !h) return [0, 0]; " +
        "const r = c.width / h.w, z = Object.values(h.helmet), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0, out = 0; " +
        "for (let i = 3; i < d.length; i += 4) { if (!d[i]) continue; n++; const p = (i - 3) / 4, x = (p % c.width + 0.5) / r, y = (Math.floor(p / c.width) + 0.5) / r; " +
        "if (!z.some(([zx, zy, zw, zh]) => x >= zx && x <= zx + zw && y >= zy && y <= zy + zh)) out++; } return [n, out]; })()";
      const markers = {};
      for (const [name, st, opt] of states) {
        const q = `${sea}&${flightQuery({ ...st, at: [40, 60] })}`;
        const p = await ctx.session.open(ctx.page, run.stillQuery(`${q}&hud=1`), { ...ctx.size, ...(opt.size || {}) });
        let fl, hud, count;
        try {
          await p.step(run.view('default').frames, 50);
          fl = await flightNow(p);
          hud = await p.eval('window.__hud()');
          count = await p.eval(painted);
          await p.shot(f(`hud-${name}`));
          pages.push(p);
        } finally {
          await p.close();
        }
        const img = readPng(f(`hud-${name}`)), dpr = (opt.size || {}).dpr || 1, w = img.w / dpr, h = img.h / dpr;
        const nose = onScreen(fl.cam, [Math.cos(fl.climb * R) * Math.sin(fl.heading * R), Math.sin(fl.climb * R), Math.cos(fl.climb * R) * Math.cos(fl.heading * R)], w, h);
        if (opt.empty) {
          lines.push(`hud-${name}: the nose at ${nose ? nose.map((v) => v.toFixed(0)).join(',') : 'behind the eye'}; ${count[0]} pixels painted on the HUD's canvas, ` +
            `${count[1]} outside the helmet's readouts; the glass ${hud && hud.airframe ? 'in view' : 'out of view'}`);
          expect(hud && !hud.airframe && count[0] > 0 && count[1] === 0, `hud-${name}: the helmet's readouts alone in view`);
          continue;
        }
        if (!hud || !hud.anchor || !hud.horizon) {
          expect(false, `hud-${name}: an anchor and a horizon line`);
          continue;
        }
        const anchorOff = Math.hypot(hud.anchor[0] - nose[0], hud.anchor[1] - nose[1]);
        // The camera's zero pitch: two level directions either side of the heading.
        const [a, b] = [-8, 8].map((d) => onScreen(fl.cam, [Math.sin((fl.heading + d) * R), 0, Math.cos((fl.heading + d) * R)], w, h));
        const camAt = (x) => a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
        const k = -Math.tan(hud.horizon.angle * R), hudAt = (x) => hud.horizon.y + k * (x - hud.horizon.x);
        const off = Math.max(...[0, w].map((x) => Math.abs(hudAt(x) - camAt(x))));
        // The green drawn: columns along the horizon line 2 to 5.5 degrees of the glass from its point on the
        // vertical through the nose, either side (clear of the marker, the bank scale and the boxes).
        const xs = [], c = Math.cos(hud.horizon.angle * R);
        for (const side of [-1, 1]) {
          for (let d = 2 * R * hud.scale; d <= 5.5 * R * hud.scale; d += 3) xs.push(hud.horizon.x + side * d * c);
        }
        const green = greenLine(img, hudAt(0), k, xs, dpr);
        const ends = [Math.min(...xs), Math.max(...xs)];
        const drawn = Math.max(...ends.map((x) => Math.abs(green.at(x) - camAt(x))));
        lines.push(`hud-${name}: the anchor off the camera's nose by ${anchorOff.toFixed(3)} px; the horizon at ${hud.horizon.angle.toFixed(3)} degrees, ` +
          `off the camera's zero pitch by ${off.toFixed(3)} px; the green drawn (${green.n} columns) off by ${drawn.toFixed(2)} px; ${count[0]} pixels painted`);
        expect(hud.airframe, `hud-${name}: the glass in view`);
        expect(anchorOff <= 1, `hud-${name}: the HUD anchored at the nose`);
        expect(off <= 1, `hud-${name}: the HUD's horizon on the camera's zero pitch`);
        expect(green.n > 20 && drawn <= 1, `hud-${name}: the green line drawn there`);
        if (opt.marker) {
          // The marker's green, in a box round the anchor (its wings 1.45, its fin 1.05 degrees of the glass).
          const F = R * hud.scale, [ax, ay] = hud.anchor;
          let n = 0, sx = 0;
          for (let y = Math.round((ay - 1.15 * F) * dpr); y <= Math.round((ay + 0.6 * F) * dpr); y++) {
            for (let x = Math.round((ax - 1.7 * F) * dpr); x <= Math.round((ax + 1.7 * F) * dpr); x++) {
              const i = 3 * (y * img.w + x), gr = img.rgb[i + 1] - Math.max(img.rgb[i], img.rgb[i + 2]);
              if (gr > 40) { n += gr; sx += gr * (x + 0.5); }
            }
          }
          const mx = n ? sx / n / dpr : NaN;
          markers[name] = { mx, nose };
          lines.push(`hud-${name}: the marker drawn at x ${mx.toFixed(2)} (anchor ${ax.toFixed(2)}, the camera's nose ${nose[0].toFixed(2)})`);
          expect(Math.abs(mx - nose[0]) <= 1, `hud-${name}: the marker drawn at the nose`);
        }
        if (!opt.sea) continue;
        // The sea's horizon, in a still of the same view without the HUD: below the HUD's line by the dip.
        pages.push(await stillAt(ctx, ctx.page, q, f(`hud-${name}-sea`)));
        const simg = readPng(f(`hud-${name}-sea`)), t = Math.tan(31 * R), dipPx = Math.tan(0.556 * R) / t * h / 2;
        const r = hud.horizon.angle * R, seen = horizonLine(simg, hudAt(0) + dipPx / Math.cos(r), k);
        const below = [w / 4, 3 * w / 4].map((x) => (seen.at(x) - hudAt(x)) * Math.cos(r));
        const miss = Math.max(...below.map((d) => Math.abs(d - dipPx)));
        lines.push(`hud-${name}: the sea's horizon at ${seen.angle.toFixed(2)} degrees, ${below.map((d) => d.toFixed(2)).join(' / ')} px below the HUD's line ` +
          `(the dip: ${dipPx.toFixed(2)} px), off by ${miss.toFixed(2)} px`);
        expect(miss <= 2, `hud-${name}: the sea's horizon below the HUD's line by the dip`);
      }
      const [m0, m1] = [markers['marker-ahead'], markers['marker-right-20']];
      if (m0 && m1) {
        const moved = m1.mx - m0.mx, want = m1.nose[0] - m0.nose[0];
        lines.push(`hud: with the eye 20 degrees to the right the marker moved by ${moved.toFixed(2)} px (the camera's nose: ${want.toFixed(2)} px)`);
        expect(Math.abs(moved - want) <= 1, 'hud: the marker moves with the nose');
      }
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },
};

// Limits, from the numbers measured on main and on broken copies (see tools/README.md), with room for noise.
const LIMITS = {
  wrap: (control) => control * 1.5 + 1,
  // 0.9: at rest the exposure stops within ADAPT_STOP of the meter's target and moves again only beyond
  // ADAPT_START; the still is drawn at the settled picture's exposure (0.63 on main, 0.71 at #31).
  settled: { gpu: 0.9, swiftshader: 0.9 },
  // cruise 1.8: the still is drawn at the flight's last exposure, so the two differ only by the picture
  // (1.21 at #31; 1.55 when each followed its own meter, 1.13 on main).
  flight: { gpu: { cruise: 1.8, low: 1.6 }, swiftshader: { cruise: 1.8, low: 1.9 } },
  // The exposure over the last 20 frames of a flight (0.3 s), its range in stops: it must hold steady, no
  // pumping. Measured 0.0024 (cruise) and 0.0030 (3 km) on the GPU, where the tracking holds it within
  // ADAPT_TRACK (0.002) of the meter, whose noise is of that size; 0.01 is three times that. A meter that pumped
  // (the glow's, say) moves it by 0.05 stops and more.
  steady: { frames: 20, range: 0.01 },
  flightBase: (base) => base * 1.1 + 0.03,
  // A banked turn against a level turn by the rudder over the same view, at the same rate (see steer).
  turn: (level) => level * 1.15 + 0.1,
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
