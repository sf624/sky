// Unit tests of the page's tables of the air, read out of index.html, and of the reference solver: node --test tools/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PAGE, loadPage, makeAir } from '../ref/air.mjs';
import { makeSolver, rng, dirOf, NORD } from '../ref/mc.mjs';

// The table of multiple scattering with `columns` columns of the sun's cosine (the page's own build).
function table(columns) {
  const text = fs.readFileSync(PAGE, 'utf8');
  const a = text.indexOf('// ---------- The atmosphere (the same model as the shader) ----------'), b = text.indexOf('// Axes: x west, y up, z south.');
  assert.ok(a >= 0 && b > a && text.slice(a, b).includes('const NMU = 40,'), 'the table\'s columns (const NMU = 40) not found');
  const src = text.slice(a, b).replace('const NMU = 40,', `const NMU = ${columns},`);
  const P = new Function(src + 'return { buildDepths, buildMultiScatter, msData, msIndex, msFall, msColumn, WY };')();
  for (const _ of P.buildDepths()); for (const _ of P.buildMultiScatter(1));
  // The luminance of the mean light in row j with the sun's cosine mus, read as the shader reads it.
  P.read = (j, mus) => {
    const x = P.msColumn(mus), i = Math.min(Math.floor(x), columns - 2), f = x - i;
    let y = 0;
    for (let w = 0; w < 12; w++) y += P.WY[w] * (P.msData[P.msIndex(j, i, w)] * (1 - f) + P.msData[P.msIndex(j, i + 1, w)] * f);
    return y * P.msFall(mus);
  };
  return P;
}

test('the table of multiple scattering, read between its columns, is that of a table eight times as fine', () => {
  // Read straight between columns 2 degrees apart, the light of twilight (e-fold a degree) came out up to 1.4
  // times too bright with the sun 1 to 5 degrees down and 1.74 times at 7.5 (main at 393b81c; issue #40): now 1.13 at most.
  const page = table(40), fine = table(313);
  let worst = 1, at = 0;
  for (let e = -12; e <= 12; e += 0.25) {
    const mus = Math.sin(e * Math.PI / 180);
    for (const j of [0, 2, 4]) {
      const r = page.read(j, mus) / fine.read(j, mus);
      if (Math.abs(Math.log(r)) > Math.abs(Math.log(worst))) { worst = r; at = e; }
    }
  }
  assert.ok(worst > 1 / 1.2 && worst < 1.2, `page / fine ${worst.toFixed(3)} with the sun at ${at} degrees`);
});

test('the reference closes: in air that absorbs nothing, under an even sky, every ray sees that sky', () => {
  // The sun's light over all its directions (4 pi times its mean) plus the unscattered way out is 1.
  const P = loadPage(), air = makeAir(P, { ozone: 0, mieExt: 1 }), S = makeSolver(air, { ground: 'lambert', albedo: 1 });
  const o = [0, P.RG + 11, 0], d = dirOf(-3.2, 0), rand = rng(3), acc = new Float64Array(NORD), N = 20000, w = 6;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), q = Math.sqrt(1 - z * z);
    acc.fill(0);
    S.path(w, rand, ...o, ...d, q * Math.cos(ph), z, q * Math.sin(ph), acc, true);
    sum += 4 * Math.PI * acc.reduce((a, b) => a + b, 0);
  }
  const one = S.once(o, d, [0, 1, 0]), total = sum / N + (one.hitG ? 0 : one.T[w]);
  assert.ok(Math.abs(total - 1) < 0.05, `closure ${total.toFixed(3)}`);
});
