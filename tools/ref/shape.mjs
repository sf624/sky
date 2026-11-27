// shape.mjs [N] [INDEX] : the table's shape of the mean light (its second moments less an even light's, over the
// mean light) against the reference's, at the table's four wavelengths.
import { loadPage, makeAir } from './air.mjs';
import { makeSolver, rng, NORD } from './mc.mjs';
const P = loadPage(process.argv[3]), N = +(process.argv[2] ?? 200000);
for (const _ of P.buildDepths()); for (const _ of P.buildMultiScatter(1));
const air = makeAir(P), S = makeSolver(air, { ground: 'lambert', albedo: P.ALBEDO });
const table = (part, h, mus) => {
  const x = Math.min(1, Math.max(0, (mus - P.MS_MU_MIN) / (1 - P.MS_MU_MIN))) * (P.NMU - 1), y = Math.sqrt(h / (P.RT - P.RG)) * (P.NH - 1);
  const i0 = Math.min(Math.floor(x), P.NMU - 2), j0 = Math.min(Math.floor(y), P.NH - 2), fx = x - i0, fy = y - j0;
  return [0, 1, 2, 3].map(c => (P.msData[P.shapeIndex(part, j0, i0, c)] * (1 - fx) + P.msData[P.shapeIndex(part, j0, i0 + 1, c)] * fx) * (1 - fy)
    + (P.msData[P.shapeIndex(part, j0 + 1, i0, c)] * (1 - fx) + P.msData[P.shapeIndex(part, j0 + 1, i0 + 1, c)] * fx) * fy);
};
const f = v => v.map(x => x.toFixed(2).padStart(5)).join(' ');
console.log('    h  sun | along the sun\'s side: reference (405 505 580 680 nm), table | up: reference, table | between: reference, table');
for (const h of [0.05, 3, 11]) for (const sun of [30, 5, 0, -2, -4, -6]) {
  const e = sun * Math.PI / 180, s = [Math.cos(e), Math.sin(e), 0], o = [0, P.RG + h, 0], acc = new Float64Array(NORD);
  const R = [[], [], []];
  P.SHAPE_W.forEach((w, c) => {
    const rand = rng(91 + w + Math.round(h * 100) + sun * 13);
    let m = 0, qh = 0, qv = 0, qc = 0;
    for (let i = 0; i < N; i++) {
      const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), q = Math.sqrt(1 - z * z), dx = q * Math.cos(ph);
      acc.fill(0);
      S.path(w, rand, ...o, dx, z, q * Math.sin(ph), ...s, acc, true);
      let v = 0; for (let k = 0; k < NORD; k++) v += acc[k];
      m += v; qh += v * dx * dx; qv += v * z * z; qc += v * dx * z;
    }
    R[0][c] = qh / m - 1 / 3; R[1][c] = qv / m - 1 / 3; R[2][c] = qc / m;
  });
  const mus = Math.sin(e);
  console.log(`${String(h).padStart(5)} ${String(sun).padStart(4)} | ${f(R[0])} , ${f(table(0, h, mus))} | ${f(R[1])} , ${f(table(1, h, mus))} | ${f(R[2])} , ${f(table(2, h, mus))}`);
}
