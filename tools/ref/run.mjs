// run.mjs --sun 0 --out F.json [--index F] [--alt 11] [--haze 1] [--ground lambert|sea] [--albedo 0.07] [--water 0.02]
//         [--n 20000] [--az 0,20,90,180] [--el ...] [--ozone 1] [--screen K,LO,HI]
// Radiance along view rays from the eye (azimuth from the sun's, elevation), per wavelength and order of
// scattering, and as the page's linear sRGB before exposure: the first order by quadrature, the rest by paths.
// The sun's elevation is at the eye's place (parallel light, no refraction, as the page's).
import fs from 'node:fs';
import { loadPage, makeAir, toRGB } from './air.mjs';
import { makeSolver, rng, dirOf, NORD } from './mc.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const P = loadPage(arg('index', undefined));
const sun = +arg('sun'), alt = +arg('alt', 11), haze = +arg('haze', 1), N = +arg('n', 20000);
const ground = arg('ground', 'lambert'), albedo = +arg('albedo', 0.07), water = +arg('water', 0.02);
const azs = arg('az', '0,20,90,180').split(',').map(Number);
const els = arg('el', '10,7,5,4,3,2,1,0,-1,-2,-3,-3.2,-3.6,-4,-4.5,-5,-6,-7.5,-10,-15').split(',').map(Number);
const air = makeAir(P, { haze, ozone: +arg('ozone', 1) });
const scr = arg('screen', '');   // k,lo,hi
const screen = scr ? (([k, lo, hi]) => ({ k, lo, hi }))(scr.split(',').map(Number)) : null;
const S = makeSolver(air, { ground, albedo, water, screen });
const o = [0, P.RG + alt, 0], s = dirOf(sun, 0), rays = [];
const t0 = Date.now();
for (const az of azs) for (const el of els) {
  const d = dirOf(el, az), one = S.once(o, d, s);
  const orders = Array.from({ length: NORD }, () => new Float64Array(P.NW)), se = new Float64Array(P.NW), acc = new Float64Array(NORD);
  const surf = new Float64Array(P.NW), accS = new Float64Array(NORD);
  for (let w = 0; w < P.NW; w++) {
    const rand = rng(1000 * (w + 1) + Math.round(az * 7 + el * 131 + sun * 17));
    let s1 = 0, s2 = 0;
    for (let i = 0; i < N; i++) {
      acc.fill(0); accS.fill(0);
      S.path(w, rand, ...o, ...d, ...s, acc, false, accS);
      let v = 0;
      for (let k = 0; k < NORD; k++) { orders[k][w] += acc[k] / N; surf[w] += accS[k] / N; v += acc[k] + accS[k]; }
      s1 += v; s2 += v * v;
    }
    se[w] = Math.sqrt(Math.max(0, s2 / N - (s1 / N) ** 2) / N);
  }
  const more = new Float64Array(P.NW), tot = new Float64Array(P.NW);
  for (let w = 0; w < P.NW; w++) { for (let k = 0; k < NORD; k++) more[w] += orders[k][w]; tot[w] = one.R[w] + one.M[w] + one.G[w] + more[w] + surf[w]; }
  rays.push({ sun, az, el, hitG: one.hitG, tmax: one.tmax, onceR: [...one.R], onceM: [...one.M], onceG: [...one.G], T: [...one.T],
    orders: orders.map(a => [...a]), surf: [...surf], se: [...se], rgbR: toRGB(P, one.R), rgbM: toRGB(P, one.M), rgbSurf: toRGB(P, surf.map((v, w) => v + one.G[w])), rgbOnce: toRGB(P, one.R.map((r, w) => r + one.M[w] + one.G[w])), rgbMore: toRGB(P, more), rgb: toRGB(P, tot), rgbSe: toRGB(P, se).map(Math.abs) });
  const r = rays.at(-1);
  console.log(`sun ${sun} az ${az} el ${el}: once ${r.rgbOnce.map(v => v.toExponential(2))} more ${r.rgbMore.map(v => v.toExponential(2))} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
fs.writeFileSync(arg('out'), JSON.stringify({ meta: { sun, alt, haze, ground, albedo, water, N, index: arg('index') }, rays }));
