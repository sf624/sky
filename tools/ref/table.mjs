// table.mjs [N] [HEIGHTS] [SUNS] [INDEX] : the page's table of multiple scattering (the mean light at a point,
// and its lean) against the reference's mean radiance there (every order, the ground's bounce of albedo 0.07).
import { loadPage, makeAir, toRGB } from './air.mjs';
import { makeSolver, rng, NORD } from './mc.mjs';
const P = loadPage(process.argv[5]), N = +(process.argv[2] ?? 100000);
for (const _ of P.buildDepths()); for (const _ of P.buildMultiScatter(1));
const air = makeAir(P), S = makeSolver(air, { ground: 'lambert', albedo: P.ALBEDO });
const table = (h, mus, index) => {
  const x = Math.min(1, Math.max(0, (mus - P.MS_MU_MIN) / (1 - P.MS_MU_MIN))) * (P.NMU - 1);
  const y = Math.sqrt(Math.min(1, Math.max(0, h / (P.RT - P.RG)))) * (P.NH - 1);
  const i0 = Math.min(Math.floor(x), P.NMU - 2), j0 = Math.min(Math.floor(y), P.NH - 2), fx = x - i0, fy = y - j0;
  const fall = P.msFall ? P.msFall(Math.min(1, Math.max(P.MS_MU_MIN, mus))) : 1;   // as the shader reads it
  return P.WL.map((_, w) => fall * (P.msData[index(j0, i0, w)] * (1 - fx) * (1 - fy) + P.msData[index(j0, i0 + 1, w)] * fx * (1 - fy)
    + P.msData[index(j0 + 1, i0, w)] * (1 - fx) * fy + P.msData[index(j0 + 1, i0 + 1, w)] * fx * fy));
};
const f = v => v.map(x => x.toExponential(2).padStart(9)).join(' ');
console.log('  h  sun | reference mean light (rgb)   r/g  b/g | table / reference  | lean to the sun over mean: ref, table | lean up over mean: ref, table');
for (const h of (process.argv[3] ?? '0.05,0.75,1.5,3,6,11').split(',').map(Number)) for (const sun of (process.argv[4] ?? '5,2,0,-1,-2,-3,-4.5').split(',').map(Number)) {
  const e = sun * Math.PI / 180, s = [Math.cos(e), Math.sin(e), 0], o = [0, P.RG + h, 0];
  const mean = new Float64Array(P.NW), lh = new Float64Array(P.NW), lv = new Float64Array(P.NW), acc = new Float64Array(NORD);
  for (let w = 0; w < P.NW; w++) {
    const rand = rng(77 + w + Math.round(h * 100) + sun * 13);
    for (let i = 0; i < N; i++) {
      const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), q = Math.sqrt(1 - z * z), d = [q * Math.cos(ph), z, q * Math.sin(ph)];
      acc.fill(0);
      S.path(w, rand, ...o, ...d, ...s, acc, true);
      let v = 0; for (let k = 0; k < NORD; k++) v += acc[k];
      mean[w] += v / N; lh[w] += v * d[0] / N; lv[w] += v * d[1] / N;
    }
  }
  const mus = Math.sin(e);
  const tm = table(h, mus, P.msIndex), th = table(h, mus, (j, i, w) => P.leanIndex(0, j, i, w)), tv = table(h, mus, (j, i, w) => P.leanIndex(1, j, i, w));
  const a = toRGB(P, mean), b = toRGB(P, tm), ah = toRGB(P, lh), bh = toRGB(P, th), av = toRGB(P, lv), bv = toRGB(P, tv);
  console.log(`${String(h).padStart(5)} ${String(sun).padStart(4)} | ${f(a)} ${(a[0] / a[1]).toFixed(2)} ${(a[2] / a[1]).toFixed(2)} | ${b.map((x, i) => (x / a[i]).toFixed(2)).join(' ')} | ${ah.map((x, i) => (x / a[i]).toFixed(2)).join(' ')} , ${bh.map((x, i) => (x / b[i]).toFixed(2)).join(' ')} | ${av.map((x, i) => (x / a[i]).toFixed(2)).join(' ')} , ${bv.map((x, i) => (x / b[i]).toFixed(2)).join(' ')}`);
}
