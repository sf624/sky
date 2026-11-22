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
    for (const m of e.measures) {
      assert.ok(M.MEASURES[m.measure], `${e.name}: ${m.measure}`);
      assert.ok(m.min !== undefined || m.max !== undefined, `${e.name}: ${m.measure} has no limit`);
    }
  }
});

test('sheet: rows of scaled pictures with labels', () => {
  const s = sheet([{ label: 'a-1', images: [pic(64, 32, () => 10), pic(64, 32, () => 200)] }], { cell: 32, gap: 2, head: 18 });
  assert.equal(s.w, 2 * 32 + 3 * 2);
  assert.equal(s.h, 2 + 18 + 16 + 2);
});
