// Unit tests of the look measures on synthetic pictures: node --test tools/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../lib/measures.mjs';
import { judge, pick } from '../lib/look.mjs';
import { sheet } from '../lib/sheet.mjs';

// A picture of w x h from f(x, y) -> [r, g, b] (or a grey level).
function pic(w, h, f) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = f(x, y), c = Array.isArray(v) ? v : [v, v, v];
    for (let k = 0; k < 3; k++) rgb[(y * w + x) * 3 + k] = Math.max(0, Math.min(255, Math.round(c[k])));
  }
  return { w, h, rgb };
}
// Seeded value noise of a few octaves: a stand-in for natural cloud (no period).
function noise(seed = 1) {
  const hash = (x, y) => { let n = (x * 374761393 + y * 668265263 + seed * 2654435761) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const sm = (t) => t * t * (3 - 2 * t);
  const v = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => { let s = 0, amp = 0.5, f = 1 / 40; for (let o = 0; o < 5; o++) { s += amp * v(x * f + o * 17.3, y * f + o * 5.1); amp /= 2; f *= 2; } return s; };
}
const W = 384, H = 256;
const natural = pic(W, H, ((n) => (x, y) => 120 + 110 * (n(x, y) - 0.5) * 2)(noise(3)));
const lattice = pic(W, H, (x, y) => 150 + 60 * Math.sin(x / 4) * Math.sin(y / 4));
const rows = pic(W, H, (x, y) => 150 + 60 * Math.sin(y / 3 + x / 40));

test('regularity: a lattice and rows score high, value noise low', () => {
  const n = M.regularity(natural), l = M.regularity(lattice), r = M.regularity(rows);
  assert.ok(l > 1.5, `lattice ${l}`);
  assert.ok(r > 1.5, `rows ${r}`);
  assert.ok(n < 0.7, `noise ${n}`);
});

test('spectrumPeak: a tile of noise shown again and again scores high, the noise itself low', () => {
  const n = noise(5), tiled = pic(W, H, (x, y) => 120 + 220 * (n(x % 24, y % 32) - 0.5));
  const t = M.spectrumPeak(tiled), f = M.spectrumPeak(natural);
  assert.ok(t > 60, `tiled ${t}`);
  assert.ok(f < 30, `noise ${f}`);
});

test('specksCv: equal dots give a small spread of sizes, dots of every size a large one', () => {
  const equal = pic(W, H, (x, y) => (Math.hypot((x % 16) - 8, (y % 16) - 8) < 3 ? 60 : 200));
  let s = 7;
  const rnd = () => ((s = Math.imul(s, 48271) % 2147483647) / 2147483647);
  const dots = Array.from({ length: 60 }, () => [rnd() * W, rnd() * H, 1.5 + 12 * rnd() ** 3]);
  const varied = pic(W, H, (x, y) => (dots.some(([a, b, r]) => Math.hypot(x - a, y - b) < r) ? 60 : 200));
  const e = M.specksCv(equal), v = M.specksCv(varied);
  assert.ok(e < 0.2, `equal ${e}`);
  assert.ok(v > 0.8, `varied ${v}`);
  assert.ok(M.speckDensity(equal) > 2 * M.speckDensity(varied));
});

test('verticalWalls and edgeRatio: tall bright bars score high, wide blobs low', () => {
  const bars = pic(W, H, (x, y) => ((x % 48) < 8 && y > 60 && y < 220 ? 230 : 60));
  const wide = pic(W, H, (x, y) => (Math.hypot(((x % 96) - 48) / 2, (y % 64) - 32) < 20 ? 230 : 60));
  const b = M.verticalWalls(bars), r = M.verticalWalls(wide);
  assert.ok(b > 0.6, `bars ${b}`);
  assert.ok(r < 0.25, `wide ${r}`);
  assert.ok(M.edgeRatio(bars) > 2 && M.edgeRatio(wide) < 1, `${M.edgeRatio(bars)} ${M.edgeRatio(wide)}`);
});

test('relief: textured cloud scores higher than flat cloud; cover counts the cloud', () => {
  const flat = pic(W, H, (x, y) => (x < W / 2 ? 220 : [30, 60, 140]));
  const n = noise(5);
  const textured = pic(W, H, (x, y) => (x < W / 2 ? 170 + 70 * (n(x, y) - 0.5) * 2 : [30, 60, 140]));
  assert.ok(M.relief(textured) > 3 * M.relief(flat));
  assert.ok(Math.abs(M.cover(flat) - 0.5) < 0.01);
});

test('lumaPct and brightColour: levels and the colour of the brightest pixels', () => {
  const grad = pic(256, 4, (x) => x);
  assert.equal(M.lumaPct(grad, { p: 50 }), 128);
  const beige = pic(64, 64, () => [235, 222, 200]), white = pic(64, 64, () => [240, 242, 245]);
  assert.ok(M.brightColour(beige, { of: 'rg' }) > 1.05);
  assert.ok(M.brightColour(beige, { of: 'bg' }) < 0.92);
  assert.ok(M.brightColour(white, { of: 'sat' }) < 0.03);
  assert.ok(M.brightColour(beige, { of: 'sat' }) > 0.1);
});

test('patchStops: patches of light and dark in stops; a gradient alone does not count when flat', () => {
  const even = pic(W, H, () => 170);
  // (Two halves, 188 and 137 in sRGB levels: a stop apart in linear light.)
  const halves = pic(W, H, (x) => (x < W / 2 ? 188 : 137));
  const ramp = pic(W, H, (x) => 120 + 80 * x / W);
  const n = noise(11);
  const patchy = pic(W, H, (x, y) => 160 + 90 * (n(x, y) - 0.5));
  assert.ok(M.patchStops(even) < 0.01);
  assert.ok(Math.abs(M.patchStops(halves) - 1) < 0.05, `halves ${M.patchStops(halves)}`);
  assert.ok(M.patchStops(ramp) > 0.8, `ramp ${M.patchStops(ramp)}`);
  assert.ok(M.patchStops(ramp, { flat: true }) < 0.12, `ramp, flat ${M.patchStops(ramp, { flat: true })}`);
  assert.ok(M.patchStops(patchy, { flat: true }) > 0.2, `patchy ${M.patchStops(patchy, { flat: true })}`);
  // (A sun's disc: its blocks are left out.)
  const sun = pic(W, H, (x, y) => ((x - 100) ** 2 + (y - 100) ** 2 < 100 ? 255 : 170));
  assert.ok(M.patchStops(sun) < 0.01);
});

test('lineDip: a dark line across the width, not the edge of one blob', () => {
  const n = noise(9);
  const base = (x, y) => 150 + 40 * (n(x, y) - 0.5);
  const line = pic(W, H, (x, y) => base(x, y) - (y === 128 ? 30 : 0));
  const edge = pic(W, H, (x, y) => base(x, y) - (y === 128 && x < 60 ? 30 : 0));
  const step = pic(W, H, (x, y) => base(x, y) - (y >= 128 ? 30 : 0));
  assert.ok(M.lineDip(line) > 0.12, `line ${M.lineDip(line)}`);
  assert.ok(M.lineDip(edge) < 0.04, `edge ${M.lineDip(edge)}`);
  assert.ok(M.lineDip(step) < 0.04, `step ${M.lineDip(step)}`);
});

test('detailScale: larger blobs, larger scale', () => {
  const fine = pic(W, H, ((m) => (x, y) => 128 + 100 * (m(x * 3, y * 3) - 0.5))(noise(2)));
  assert.ok(M.detailScale(natural) > 1.5 * M.detailScale(fine));
});

test('judge: PASS, FAIL, KNOWN, and PASS? for a known flaw that passes', () => {
  const img = pic(16, 16, () => 100);
  const e = (min, expected) => ({ name: 'x', measures: [{ measure: 'lumaPct', min }], expected });
  assert.equal(judge(e(50), img).status, 'PASS');
  assert.equal(judge(e(150), img).status, 'FAIL');
  assert.equal(judge(e(150, 'fail'), img).status, 'KNOWN');
  assert.equal(judge(e(50, 'fail'), img).status, 'UNEXPECTED');
  assert.throws(() => pick({ entries: [{ name: 'a' }] }, { only: 'b' }));
});

test('the registry: every entry has a query, a date, what was wrong, and known measures with limits', async () => {
  const { loadRegistry } = await import('../lib/look.mjs');
  const names = new Set();
  for (const e of loadRegistry().entries) {
    assert.ok(!names.has(e.name), `${e.name} twice`);
    names.add(e.name);
    assert.ok(e.q && e.reported && e.wrong, `${e.name}: q, reported, wrong`);
    if (e.sweep) assert.ok(e.sweep.param && e.sweep.values.length >= 2, `${e.name}: a sweep of a parameter, two values at least`);
    for (const m of e.measures) {
      assert.ok(M.MEASURES[m.measure], `${e.name}: ${m.measure}`);
      assert.ok(m.min !== undefined || m.max !== undefined, `${e.name}: ${m.measure} has no limit`);
    }
  }
});

test('coverRise and coverFall: the largest rise and fall of the cover between neighbouring pictures', () => {
  const grey = (v) => pic(40, 20, (x) => (x < v * 40 ? 230 : 40));
  const imgs = [0.2, 0.3, 0.7, 0.65].map(grey);
  assert.ok(Math.abs(M.coverRise(imgs) - 0.4) < 1e-9);
  assert.ok(Math.abs(M.coverFall(imgs) - 0.05) < 0.03);
  assert.equal(M.coverFall([0.1, 0.2].map(grey)), 0);
});

test('exposureStep: the largest change of the exposure between neighbouring pictures', () => {
  const at = (exposure) => ({ ...pic(4, 4, () => 0), exposure });
  assert.ok(Math.abs(M.exposureStep([3.9, 4.7, 5.5, 7.9, 8.8].map(at)) - 2.4) < 1e-9);
  assert.ok(Math.abs(M.exposureStep([9, 8.5, 8.6].map(at)) - 0.5) < 1e-9);
  assert.throws(() => M.exposureStep([at(1), pic(4, 4, () => 0)]), /without its exposure/);
});

test('lumaRise: the largest rise of the mean luma from a picture to a later one', () => {
  const grey = (v) => pic(8, 8, () => v);
  assert.equal(M.lumaRise([60, 40, 20, 10].map(grey)), 0);
  assert.ok(Math.abs(M.lumaRise([60, 15, 20, 18, 45, 30].map(grey)) - 30) < 1e-9);
  assert.ok(Math.abs(M.lumaRise([grey(10), pic(8, 8, (x) => (x < 4 ? 10 : 50))], { region: [0.5, 0, 0.5, 1] }) - 40) < 1e-9);
});

test('flatPlate: a large smooth bright part, not knobbly cloud', () => {
  // (Grain at every pixel: knobs, as cloud tops are at this scale.)
  const grain = (x, y) => { let n = (x * 374761393 + y * 668265263) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const knobbly = pic(120, 80, (x, y) => 160 + 80 * grain(x, y));
  const plate = pic(120, 80, (x, y) => (x > 20 && x < 100 && y > 20 && y < 60 ? 200 : 160 + 80 * grain(x, y)));
  assert.ok(M.flatPlate(knobbly) < 0.05);
  assert.ok(M.flatPlate(plate) > 0.2);
});

test('sheet: rows of scaled pictures with labels', () => {
  const s = sheet([{ label: 'a-1', images: [pic(64, 32, () => 10), pic(64, 32, () => 200)] }], { cell: 32, gap: 2, head: 18 });
  assert.equal(s.w, 2 * 32 + 3 * 2);
  assert.equal(s.h, 2 + 18 + 16 + 2);
});

test('grain: a pepper of dark pixels on a smooth base scores high, the smooth base and value noise low', () => {
  const smooth = pic(W, H, (x, y) => 100 + 20 * Math.sin(x / 60) * Math.sin(y / 50));
  const pepper = pic(W, H, (x, y) => 100 + 20 * Math.sin(x / 60) * Math.sin(y / 50) - ((x * 7 + y * 13) % 29 === 0 ? 30 : 0));
  const s = M.grain(smooth), p = M.grain(pepper), n = M.grain(natural);
  assert.ok(s < 0.4, `smooth ${s}`);             // the rounding to 8 bits alone
  assert.ok(p > 2, `pepper ${p}`);
  assert.ok(n < 1, `noise ${n}`);
});

test('stars: points 12 levels or more over their surroundings, per 10 000 px', () => {
  const pts = [[10, 10, 60], [40, 20, 30], [70, 30, 8], [100, 40, 40]];   // x, y, levels over a sky of 5
  const img = pic(200, 50, (x, y) => 5 + (pts.find((p) => p[0] === x && p[1] === y) || [0, 0, 0])[2]);
  assert.ok(Math.abs(M.stars(img) - 3 / (200 * 50) * 1e4) < 1e-9);          // the one 8 levels over is not seen
  assert.ok(Math.abs(M.stars(img, { t: 5 }) - 4 / (200 * 50) * 1e4) < 1e-9);
});

test('starShape: points near 1, dotted streaks well over 2', () => {
  // Gaussian points of a pixel and a half across, and the same points copied four times, 4 px apart along a slope.
  const at = (list) => (x, y) => 8 + list.reduce((s, [px, py, v]) => s + v * Math.exp(-((x - px) ** 2 + (y - py) ** 2) / 0.6), 0);
  const centres = [[20, 20], [60, 30], [100, 20], [140, 35], [180, 25]];
  const points = pic(200, 60, at(centres.map(([x, y]) => [x, y, 150])));
  const streaks = pic(200, 60, at(centres.flatMap(([x, y]) => [0, 1, 2, 3].map((i) => [x - 6 + 4 * i, y + 2 - i, 150]))));
  assert.ok(M.starShape(points) < 1.3, `points ${M.starShape(points)}`);
  assert.ok(M.starShape(streaks) > 2.5, `streaks ${M.starShape(streaks)}`);
});

test('judge: a measure against another entry\'s still is their ratio', () => {
  const a = pic(20, 20, () => 40), b = pic(20, 20, () => 20);
  const e = { name: 'up', measures: [{ measure: 'lumaPct', against: 'level', max: 1.5 }] };
  const r = judge(e, a, (n) => (assert.equal(n, 'level'), b));
  assert.equal(r.status, 'FAIL');
  assert.ok(Math.abs(r.values[0].value - 2) < 1e-9);
  const reg = { entries: [e, { name: 'level', measures: [] }, { name: 'other', measures: [] }] };
  assert.deepEqual(pick(reg, { only: 'up' }).map((x) => x.name), ['up', 'level']);
});

test('fringe: white blobs alone score low, blobs with streaks of foam beside them high', () => {
  // White ellipses on dark water; then the same with thin, dimmer streaks trailing to the right of each.
  const blobsAt = [[40, 40], [120, 70], [200, 40], [280, 80]];
  const blob = (x, y) => blobsAt.some(([bx, by]) => ((x - bx) / 6) ** 2 + ((y - by) / 10) ** 2 < 1);
  const streak = (x, y) => blobsAt.some(([bx, by]) => x > bx + 4 && x < bx + 40 && (y - by + 9) % 4 === 0 && Math.abs(y - by) < 9);
  const plain = pic(320, 120, (x, y) => (blob(x, y) ? 250 : 40));
  const trails = pic(320, 120, (x, y) => (blob(x, y) ? 250 : streak(x, y) ? 160 : 40));
  assert.ok(M.fringe(plain) < 0.05, `plain ${M.fringe(plain)}`);
  assert.ok(M.fringe(trails) > 0.15, `trails ${M.fringe(trails)}`);
});
