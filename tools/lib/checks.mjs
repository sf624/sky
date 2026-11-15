// The checks. Each returns { ok, msg } (or { skip }) and writes its pictures and traces under dir/NAME/.
// Those that compare with a base need --base; the others test the page alone.
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './browser.mjs';
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

export const CHECKS = {
  // The GL trace of a few views, against the base's: every call and every read-back the same.
  async trace(ctx) {
    if (!ctx.base) return { skip: 'needs --base' };
    const ignore = new Set(ctx.ignore.split(',').filter(Boolean));
    const lines = [], notes = [];
    let ok = true;
    for (const name of ['default', 'night-dark', 'sea-low-sun']) {
      const v = run.view(name);
      const q = name === 'default' ? '' : v.q;   // the default view flies, as the page does when opened
      const size = run.parseSize(run.TRACE_SIZE);
      const files = {};
      for (const [who, root] of [['base', ctx.base], ['page', ctx.page]]) {
        files[who] = path.join(ctx.dir, `${name}.${who}.trace`);
        const r = await run.trace(ctx.session, root, { q, size, file: files[who] });
        if (r.errors.length) { ok = false; lines.push(`${name} (${who}): ERRORS ${r.errors.join(' | ')}`); }
      }
      const r = compareTraces(fs.readFileSync(files.base, 'utf8'), fs.readFileSync(files.page, 'utf8'), { ignore, max: 4 });
      for (const n of r.notes.map((x) => x.replace(' in A', ' in the base').replace(' in B', ' on this page'))) {
        if (!notes.includes(n)) notes.push(n);
      }
      if (!r.same) { ok = false; lines.push(`${name}: ${r.summary}`, ...r.report.map((l) => '    ' + l)); }
    }
    const same = `3 views, identical${ignore.size ? ` (ignoring ${[...ignore].join(', ')})` : ''}`;
    return { ok, msg: [...(ok ? [same] : lines), ...notes].join('\n') };
  },

  // Stills of every view against the base's: max difference 0.
  async stills(ctx) {
    if (!ctx.base) return { skip: 'needs --base' };
    const bad = [], errors = [];
    let n = 0;
    for (const name of run.viewNames()) {
      const v = run.view(name);
      const fp = path.join(ctx.dir, `${name}.png`), fb = path.join(ctx.dir, `${name}.base.png`);
      const a = await run.still(ctx.session, ctx.page, v, ctx.size, fp);
      const b = await run.still(ctx.session, ctx.base, v, ctx.size, fb);
      errors.push(...a.errors, ...b.errors.map((e) => 'base: ' + e));
      const d = diffPng(fb, fp, { out: path.join(ctx.dir, `${name}.diff.png`) });
      n++;
      if (d.max) bad.push(`${name}: ${fmtDiff(d)}`);
    }
    const ok = !bad.length && !errors.length;
    return { ok, msg: ok ? `${n} views, max difference 0` : [...bad, ...errors].join('\n') };
  },

  // The skylight (#sky2) against the base's, scrolled into view: pixel for pixel. Skipped where a page has none.
  async skylight(ctx) {
    if (!ctx.base) return { skip: 'needs --base' };
    const views = { day: 'time=13&date=172', dusk: 'time=17.6&date=80', night: 'time=21&date=80&moon=14', haze: 'time=9&haze=4&date=300' };
    const bad = [], errors = [];
    for (const [name, q] of Object.entries(views)) {
      const files = {};
      for (const [who, root] of [['base', ctx.base], ['page', ctx.page]]) {
        const p = await ctx.session.open(root, q + '&speed=0', { ...ctx.size, hide: false });
        try {
          const r = await p.eval(`(() => { const c = document.getElementById('sky2'); if (!c) return null;
            c.scrollIntoView({ block: 'center' });
            const b = c.getBoundingClientRect();
            return [b.left + scrollX, b.top + scrollY, b.width, b.height].map(Math.round); })()`);
          if (!r) return { skip: `no #sky2 on ${who === 'base' ? 'the base' : 'this page'}: skipped` };
          await p.eval('window.__realFrame().then(() => window.__realFrame()).then(() => 0)');
          await p.step(3, 50);
          files[who] = path.join(ctx.dir, `${name}.${who}.png`);
          // The clip is in page coordinates, not in those of the viewport.
          await p.shot(files[who], { x: r[0], y: r[1], width: r[2], height: r[3] });
          errors.push(...p.errors);
        } finally {
          await p.close();
        }
      }
      const d = diffPng(files.base, files.page, { out: path.join(ctx.dir, `${name}.diff.png`) });
      if (d.max) bad.push(`${name}: ${fmtDiff(d)}`);
      // A flat picture would mean that the clip missed the sky, or that nothing was drawn.
      let lo = 255, hi = 0;
      for (const v of readPng(files.page).rgb) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo < 8) bad.push(`${name}: the skylight is flat (nothing drawn, or the clip missed it)`);
    }
    const ok = !bad.length && !errors.length;
    return { ok, msg: ok ? '4 views, identical' : [...bad, ...errors].join('\n') };
  },

  // No seam where the way flown wraps at 256 km: two stills 2.8 m apart across the wrap differ no more than two
  // stills 2.8 m apart elsewhere; a flight across the wrap matches stills along it as well as a flight elsewhere.
  async wrap(ctx) {
    const v = 'date=172&time=14&cloud=0.6&yaw=40&pitch=-14&heading=0';
    const f = (n) => path.join(ctx.dir, n + '.png');
    const pages = [];
    for (const [n, x, z] of [['s1', 255.999, 255.999], ['s2', 0.001, 0.001], ['c1', 100.999, 100.999], ['c2', 101.001, 101.001]]) {
      pages.push(await stillAt(ctx, ctx.page, `${v}&at=${x},${z}`, f(n)));
    }
    const across = diffPng(f('s1'), f('s2')), control = diffPng(f('c1'), f('c2'));
    const lines = [`stills across the wrap: ${fmtDiff(across)}; elsewhere: ${fmtDiff(control)}`];
    let ok = across.mean <= LIMITS.wrapStill(control.mean);
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
      lines.push(`frame ${k} of a flight against the still there: across ${fmtDiff(a)}; elsewhere ${fmtDiff(c)}`);
      ok = ok && a.mean <= LIMITS.wrapFlight(c.mean);
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },

  // The loop: it stops at rest, in a hidden tab and with the hero out of view, and starts again; with the hero
  // out of view, the time-lapse draws only the skylight (where there is one).
  async loop(ctx) {
    const lines = [], pages = [];
    let ok = true;
    const expect = (cond, text) => { if (!cond) { ok = false; lines.push('not so: ' + text); } };
    const open = async (q) => { const p = await ctx.session.open(ctx.page, q, { ...ctx.size, hide: false }); pages.push(p); return p; };
    const counts = async (p) => { const d = await p.draws(); return { sky: d.sky ? d.sky.screen + d.sky.offscreen : 0, sky2: d.sky2 ? d.sky2.screen : 0 }; };
    const real = (p) => p.eval('window.__realFrame().then(() => window.__realFrame()).then(() => 0)').then(() => sleep(200));
    const hidden = (h) => `(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${h} });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${h} ? 'hidden' : 'visible' });
      document.dispatchEvent(new Event('visibilitychange')); return 0; })()`;
    // Scrolls the hero just out of view (or back to the top); true if it is out of view then. A page with nothing
    // below the hero cannot scroll it away, and needs no pause out of view (the page since 4ccf2e4).
    const scroll = (out) => `(() => { const c = document.getElementById('sky');
      window.scrollTo(0, ${out ? 'scrollY + c.getBoundingClientRect().bottom + 1' : 0});
      return c.getBoundingClientRect().bottom <= 0; })()`;
    const pending = (p) => p.eval('window.__pending()');
    try {
      let p = await open('speed=0');
      await p.step(60, 16);
      const r1 = await counts(p);
      await p.step(60, 16);
      const r2 = await counts(p), rq = await pending(p);
      lines.push(`at rest: hero draws ${r1.sky} after 60 frames, ${r2.sky} after 120; ${rq} frames queued`);
      expect(r1.sky > 0 && r2.sky === r1.sky && rq === 0, 'the hero stops drawing at rest');

      p = await open('');
      await p.step(10, 16);
      const h1 = await counts(p);
      await p.eval(hidden(true));
      await p.step(10, 16);
      const h2 = await counts(p), hq = await pending(p);
      await p.eval(hidden(false));
      await p.step(10, 16);
      const h3 = await counts(p);
      lines.push(`flying, hidden, visible: hero draws ${h1.sky}, ${h2.sky}, ${h3.sky}; ${hq} frames queued while hidden`);
      expect(h1.sky > 0 && h2.sky === h1.sky && h2.sky2 === h1.sky2 && hq === 0, 'nothing is drawn in a hidden tab');
      expect(h3.sky > h2.sky, 'drawing starts again when the tab is shown');

      p = await open('');
      await p.step(10, 16);
      const s1 = await counts(p);
      if (!(await p.eval(scroll(true)))) {
        lines.push('the page cannot scroll the hero out of view: those parts skipped');
      } else {
        await real(p);
        await p.step(10, 16);
        const s2 = await counts(p), sq = await pending(p);
        await p.eval(scroll(false));
        await real(p);
        await p.step(10, 16);
        const s3 = await counts(p);
        lines.push(`flying, scrolled past the hero, back: hero draws ${s1.sky}, ${s2.sky}, ${s3.sky}; ${sq} frames queued out of view`);
        expect(s2.sky === s1.sky && sq === 0, 'the hero is not drawn out of view');
        expect(s3.sky > s2.sky, 'the hero is drawn again in view');

        p = await open('speed=0');
        await p.step(60, 16);
        const t1 = await counts(p);
        const skylight = await p.eval("!!document.getElementById('sky2')");
        await p.eval("(document.getElementById('play').click(), 0)");
        await p.eval(scroll(true));
        await real(p);
        await p.step(20, 16);
        const t2 = await counts(p);
        await p.eval(scroll(false));
        await real(p);
        await p.step(5, 16);
        const t3 = await counts(p);
        lines.push(`time-lapse out of view: hero ${t1.sky} -> ${t2.sky}, ` +
          (skylight ? `skylight ${t1.sky2} -> ${t2.sky2}` : 'no #sky2 on this page: skylight skipped') + `; back in view: hero ${t3.sky}`);
        expect(t2.sky === t1.sky, 'out of view, the time-lapse does not draw the hero');
        if (skylight) expect(t2.sky2 > t1.sky2, 'out of view, the time-lapse draws the skylight');
        expect(t3.sky > t2.sky, 'back in view, the time-lapse draws the hero');
      }
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
    expect(diffPng(still, f('settled')).mean <= LIMITS.settled, 'the settled picture matches the still');

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
  async flight(ctx) {
    const flights = [
      { name: 'cruise', q: 'date=172&time=15&yaw=20&pitch=-12', frames: 61 },
      { name: 'low', q: 'date=172&time=14&alt=3&pitch=-5&yaw=60', frames: 61 },
    ];
    const f = (n) => path.join(ctx.dir, n + '.png');
    const lines = [], pages = [];
    let ok = true;
    for (const fl of flights) {
      pages.push(await shoot(ctx, ctx.page, `${fl.q}&speed=900&heading=0&at=40,60`, [[fl.frames, 16]], f(fl.name)));
      pages.push(await stillAt(ctx, ctx.page, `${fl.q}&heading=0&${at(reached(40, 60, 900, 0, fl.frames, 16))}`, f(fl.name + '-still')));
      const d = diffPng(f(fl.name + '-still'), f(fl.name), { out: f(fl.name + '-diff') });
      lines.push(`${fl.name}: ${fl.frames} frames flown against the still: ${fmtDiff(d)}`);
      if (d.mean > LIMITS.flight) ok = false;
    }
    const errors = errorsOf(pages);
    return { ok: ok && !errors.length, msg: [...lines, ...errors].join('\n') };
  },
};

// Limits, from the numbers measured on main (see tools/README.md), with room for noise.
const LIMITS = {
  wrapStill: (control) => control * 1.5 + 0.3,
  wrapFlight: (control) => control * 1.5 + 0.3,
  settled: 1.5,
  flight: 1.3,
};

export async function runChecks(session, { names, page, base, size, gpu, dir, ignore }) {
  const list = names.length ? names : Object.keys(CHECKS);
  for (const n of list) if (!CHECKS[n]) throw new Error(`no check ${n} (${Object.keys(CHECKS).join(', ')})`);
  const t0 = Date.now();
  let failed = 0, skipped = 0;
  console.log(`page ${page}${base ? `, base ${base}` : ''}, ${size.w}x${size.h}, ${gpu ? 'GPU' : 'SwiftShader'}`);
  for (const name of list) {
    const t = Date.now();
    const sub = path.join(dir, name);
    fs.mkdirSync(sub, { recursive: true });
    let r;
    try {
      r = await CHECKS[name]({ session, page, base, size, dir: sub, ignore });
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
