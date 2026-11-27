// validate.mjs [all|depth|closure|once|twice|zenith] [INDEX] : checks of the reference itself, each against a
// known answer (see tools/README.md).
import { loadPage, makeAir, makeDepth, toRGB } from './air.mjs';
import { makeSolver, rng, dirOf, NORD } from './mc.mjs';
const which = process.argv[2] ?? 'all';
const P = loadPage(process.argv[3]);
const eye = alt => [0, P.RG + alt, 0];
const sum = a => a.reduce((x, y) => x + y, 0);

if (which === 'all' || which === 'depth') {
  // 1. The depth table against a direct sum of 20000 steps.
  const air = makeAir(P), dep = makeDepth(air), a = [0, 0, 0], b = [0, 0, 0], rand = rng(1);
  let worst = [0, 0, 0], n = 0;
  for (let i = 0; i < 3000; i++) {
    const h = i % 3 === 0 ? 3 * rand() : 100 * rand() ** 2, r = P.RG + h;
    const mu = i % 2 ? (rand() - 0.5) * 0.3 : 2 * rand() - 1;
    const ok = dep.depth(r, mu, a), ok2 = dep.direct(r, mu, b);
    if (ok !== ok2) throw new Error('blocked differs');
    if (!ok) continue;
    n++;
    // the error of the optical depth, at the wavelength where each species is strongest
    const k = [air.bR[0], air.bMe[0], air.bO[8]];
    for (let c = 0; c < 3; c++) worst[c] = Math.max(worst[c], Math.abs(a[c] - b[c]) * k[c] / (1 + b[c] * k[c]));
  }
  console.log(`depth table vs direct sum, ${n} rays: worst error of the optical depth (absolute below 1, relative above): air ${worst[0].toExponential(2)} aerosol ${worst[1].toExponential(2)} ozone ${worst[2].toExponential(2)}`);
}

if (which === 'all' || which === 'closure') {
  // 2. Closure. In air that absorbs nothing (no ozone, aerosol albedo 1)
  // over a white Lambert ground, under a sky equally bright from every
  // side, every ray sees that brightness: the sun's light summed over all
  // sun directions (4 pi times its mean), plus the unscattered way out, is 1.
  for (const haze of [1, 4]) {
    const air = makeAir(P, { haze, ozone: 0, mieExt: 1 });
    const S = makeSolver(air, { ground: 'lambert', albedo: 1 });
    for (const [alt, el] of [[11, -10], [11, -3.2], [11, 0], [11, 10], [0.3, 1], [0.3, 40]]) {
      for (const w of [0, 6, 11]) {
        const rand = rng(100 + w), N = 60000, acc = new Float64Array(NORD), o = eye(alt), d = dirOf(el, 0);
        let s1 = 0, s2 = 0;
        for (let i = 0; i < N; i++) {
          const z = 2 * rand() - 1, ph = 2 * Math.PI * rand(), q = Math.sqrt(1 - z * z);
          acc.fill(0);
          S.path(w, rand, ...o, ...d, q * Math.cos(ph), z, q * Math.sin(ph), acc, true);
          const v = 4 * Math.PI * sum(acc); s1 += v; s2 += v * v;
        }
        const one = S.once(o, d, [0, 1, 0]), out = one.hitG ? 0 : one.T[w];
        const mean = s1 / N, se = Math.sqrt((s2 / N - mean * mean) / N);
        console.log(`closure haze ${haze} alt ${alt} el ${el} ${P.WL[w]} nm: scattered ${mean.toFixed(4)} +- ${se.toFixed(4)} + out ${out.toFixed(4)} = ${(mean + out).toFixed(4)}`);
      }
    }
  }
}

if (which === 'all' || which === 'once') {
  // 3. The first order by paths against the quadrature, the real air.
  const air = makeAir(P), S = makeSolver(air, { ground: 'lambert', albedo: 0.07 });
  for (const [sun, el, az] of [[2, -5, 0], [0, -5, 180], [0, 1, 180], [-2, 2, 180], [-2, -6, 90], [-2, 1, 0]]) {
    const o = eye(11), d = dirOf(el, az), s = dirOf(sun, 0), one = S.once(o, d, s);
    for (const w of [1, 6, 10]) {
      const rand = rng(7 + w), N = 200000, acc = new Float64Array(NORD);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) { acc.fill(0); S.path(w, rand, ...o, ...d, ...s, acc, true); s1 += acc[0]; s2 += acc[0] * acc[0]; }
      const mean = s1 / N, se = Math.sqrt((s2 / N - mean * mean) / N), q = one.R[w] + one.M[w] + one.G[w];
      console.log(`once sun ${sun} el ${el} az ${az} ${P.WL[w]} nm: paths ${mean.toExponential(4)} +- ${(se / mean * 100).toFixed(2)} %  quadrature ${q.toExponential(4)}  ratio ${(mean / q).toFixed(4)}`);
    }
  }
}

if (which === 'all' || which === 'twice') {
  // 4. The second order by a direct triple sum (no aerosol: the phase is
  // smooth), black ground, twilight geometry, against the paths' second order.
  const air = makeAir(P, { haze: 0 }), S = makeSolver(air, { ground: 'lambert', albedo: 0 }), ds = [0, 0, 0];
  const N1 = 96, NT = 48, NP = 96, N2 = 96;
  for (const [sun, el, az] of [[-2, -5, 180], [-2, 2, 0], [0, -6, 90]]) {
    const o = eye(11), d = dirOf(el, az), s = dirOf(sun, 0);
    for (const w of [2, 8]) {
      const bR = air.bR[w], bO = air.bO[w];
      const seg = (p, dir) => {   // distance to the ground or the top
        const r2 = p[0] ** 2 + p[1] ** 2 + p[2] ** 2, b = p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2];
        const dg = b * b - r2 + P.RG ** 2;
        return b < 0 && dg > 0 ? -b - Math.sqrt(dg) : -b + Math.sqrt(Math.max(0, b * b - r2 + P.RT ** 2));
      };
      // radiance scattered once seen from p along dir
      const L1 = (p, dir) => {
        const tm = seg(p, dir), c = dir[0] * s[0] + dir[1] * s[1] + dir[2] * s[2], pR = P.phaseR(c);
        let tau = 0, L = 0, last = 0;
        for (let i = 0; i < N2; i++) {
          const f = (i + 1) / N2, t1 = tm * f * f, dt = t1 - last, t = last + 0.5 * dt; last = t1;
          const x = p[0] + dir[0] * t, y = p[1] + dir[1] * t, z = p[2] + dir[2] * t, r = Math.hypot(x, y, z), h = Math.max(0, r - P.RG);
          const e = (bR * air.rhoR(h) + bO * air.rhoO(h)) * dt;
          tau += 0.5 * e;
          const T = S.sunT(w, r, (x * s[0] + y * s[1] + z * s[2]) / r);
          L += Math.exp(-tau) * bR * air.rhoR(h) * dt * pR * T;
          tau += 0.5 * e;
        }
        return L;
      };
      const tm = seg(o, d);
      let tau = 0, L2 = 0, last = 0;
      for (let i = 0; i < N1; i++) {
        const f = (i + 1) / N1, t1 = tm * f * f, dt = t1 - last, t = last + 0.5 * dt; last = t1;
        const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t], h = Math.max(0, Math.hypot(...p) - P.RG);
        const e = (bR * air.rhoR(h) + bO * air.rhoO(h)) * dt;
        tau += 0.5 * e;
        let g = 0;
        for (let a = 0; a < NT; a++) {
          const z = -1 + 2 * (a + 0.5) / NT, q = Math.sqrt(1 - z * z);
          for (let b = 0; b < NP; b++) {
            const ph = 2 * Math.PI * (b + 0.5) / NP, dir = [q * Math.cos(ph), z, q * Math.sin(ph)];
            g += P.phaseR(dir[0] * d[0] + dir[1] * d[1] + dir[2] * d[2]) * L1(p, dir);
          }
        }
        L2 += Math.exp(-tau) * bR * air.rhoR(h) * dt * g * 4 * Math.PI / (NT * NP);
        tau += 0.5 * e;
      }
      const rand = rng(11 + w), N = 400000, acc = new Float64Array(NORD);
      let s1 = 0, s2 = 0;
      for (let i = 0; i < N; i++) { acc.fill(0); S.path(w, rand, ...o, ...d, ...s, acc, true); s1 += acc[1]; s2 += acc[1] * acc[1]; }
      const mean = s1 / N, se = Math.sqrt((s2 / N - mean * mean) / N);
      console.log(`twice sun ${sun} el ${el} az ${az} ${P.WL[w]} nm: paths ${mean.toExponential(4)} +- ${(se / mean * 100).toFixed(2)} %  triple sum ${L2.toExponential(4)}  ratio ${(mean / L2).toFixed(4)}`);
    }
  }
}

if (which === 'all' || which === 'zenith') {
  // 5. The zenith from sea level against measurements (the fit to sky
  // quality meter readings quoted in docs/design.md): cd/m2.
  const air = makeAir(P), S = makeSolver(air, { ground: 'lambert', albedo: 0.07 });
  for (const [sun, meas] of [[0, 216], [-6, 0.63]]) {
    const o = eye(0.01), d = [0, 1, 0], s = dirOf(sun, 0), one = S.once(o, d, s), L = new Float64Array(P.NW);
    for (let w = 0; w < P.NW; w++) {
      const rand = rng(31 + w), N = 40000, acc = new Float64Array(NORD);
      for (let i = 0; i < N; i++) S.path(w, rand, ...o, ...d, ...s, acc, false);
      L[w] = one.R[w] + one.M[w] + sum(acc) / N;
    }
    const y = P.WY.reduce((a, wy, w) => a + wy * L[w], 0) * 133000;
    console.log(`zenith from sea level, sun ${sun}: ${y.toPrecision(3)} cd/m2 (measured ${meas}); linear sRGB ${toRGB(P, L).map(v => v.toExponential(2))}`);
  }
}
