// A Monte Carlo reference for the page's atmosphere: a sphere, the planet's
// shadow, every order of scattering, ozone, the aerosol with its phase
// functions by height, and a ground (Lambert, or a flat sea). Written for
// this check from textbook transport theory: backward paths from the eye,
// free paths by delta tracking against a majorant per shell, the sun's light
// taken at every collision (next-event estimation), absorption as a weight.
// One wavelength at a time (no spectral reuse): simple, and unbiased.
// Units: radiance per unit of the sun's irradiance outside the air (1/sr).
import { makeDepth } from './air.mjs';

export function rng(seed) {   // sfc32
  let a = seed | 0, b = 0x9e3779b9 | 0, c = 0x243f6a88 | 0, d = 1;
  const next = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11); c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 20; i++) next();
  return next;
}

const HS = [0, 0.25, 0.5, 0.75, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.3, 2.6, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 23, 26, 30, 35, 40, 50, 60, 80, 100];
export const NORD = 8;   // orders kept apart: 1, 2, ..., NORD and more

export function makeSolver(air, opts = {}) {
  const P = air.P, RG = air.RG, NS = HS.length - 1;
  const RS = HS.map(h => RG + h);
  const dep = opts.depth ?? makeDepth(air);
  const up = P.AERO_UP, clampTo = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  // The ground: 'lambert' with albedo (a number, or one per wavelength), or
  // 'sea': a flat mirror by Fresnel (n = 1.34) over water whose own light is
  // Lambert with albedo `water`.
  const ground = opts.ground ?? 'lambert';
  const albedo = w => Array.isArray(opts.albedo) ? opts.albedo[w] : (opts.albedo ?? 0);
  const water = w => Array.isArray(opts.water) ? opts.water[w] : (opts.water ?? 0);
  const g1 = P.MIE_PHASE[1], g2 = P.MIE_PHASE[2], wSharp = P.MIE_PHASE[0], gU = P.MIE_G_UP;
  const ds = [0, 0, 0];

  function majorants(w) {
    const m = new Float64Array(NS);
    for (let i = 0; i < NS; i++) {
      const lo = HS[i], hi = HS[i + 1];
      const upMax = up[0][0] * Math.exp(-(((clampTo(up[0][1], lo, hi) - up[0][1]) / up[0][2]) ** 2))
                  + up[1][0] * Math.exp(-(((clampTo(up[1][1], lo, hi) - up[1][1]) / up[1][2]) ** 2));
      m[i] = (air.bR[w] * air.rhoR(lo) + air.bMe[w] * (air.rhoB(lo) + upMax) + air.bO[w] * air.rhoO(clampTo(25, lo, hi))) * (1 + 1e-9);
    }
    return m;
  }
  const majs = P.WL.map((_, w) => majorants(w));

  // The sun's transmittance to a point at radius r, the sun's zenith cosine
  // mu there; 0 behind the planet.
  // opts.screen: { k, lo, hi }: a layer of clouds far off that takes the
  // sun's beam (not the sky's light): its extinction k per km below lo km,
  // falling to none at hi km (the mean of a field of clouds). The beam's
  // optical depth through it, from the point towards the sun.
  const screen = opts.screen ?? null;
  function screenDepth(r, mu) {
    if (!screen) return 0;
    const rHi = RG + screen.hi, b = r * mu, c = r * r - rHi * rHi, disc = b * b - c;
    if (disc <= 0) return 0;
    const sq = Math.sqrt(disc), t0 = Math.max(0, -b - sq), t1 = -b + sq;
    if (t1 <= t0) return 0;
    const n = 32, dt = (t1 - t0) / n, s2 = r * r * (1 - mu * mu);
    let tau = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + (i + 0.5) * dt, h = Math.sqrt(s2 + (b + t) * (b + t)) - RG;
      const x = Math.min(1, Math.max(0, (screen.hi - h) / (screen.hi - screen.lo)));
      tau += screen.k * x * x * (3 - 2 * x) * dt;
    }
    return tau;
  }
  function sunT(w, r, mu) {
    if (!dep.depth(r, mu, ds)) return 0;
    return Math.exp(-(air.bR[w] * ds[0] + air.bMe[w] * ds[1] + air.bO[w] * ds[2]) - screenDepth(r, mu));
  }

  // One path from o along d, wavelength w, sun direction s. Adds the sun's
  // light by order into accAir (NORD values), or into accSurface when the
  // ray's first event is the ground (the surface's light through the air).
  // firstNEE false: the first order is left out (taken by quadrature).
  function path(w, rand, ox, oy, oz, dx, dy, dz, sx, sy, sz, accAir, firstNEE, accSurface = accAir) {
    const maj = majs[w], bR = air.bR[w], bM = air.bM[w], bMe = air.bMe[w], bO = air.bO[w];
    let px = ox, py = oy, pz = oz, thr = 1, order = 1, acc = accAir;
    let r = Math.hypot(px, py, pz), h = r - RG;
    let si = 0;
    while (si < NS - 1 && HS[si + 1] <= h) si++;
    for (;;) {
      // Free path.
      let hit = 0;   // 1 collision, 2 ground, 3 out
      for (;;) {
        const r2 = px * px + py * py + pz * pz, b = px * dx + py * dy + pz * dz;
        const ro = RS[si + 1], ri = RS[si];
        const tOut = -b + Math.sqrt(Math.max(0, b * b - r2 + ro * ro));
        let tIn = Infinity;
        if (b < 0) { const disc = b * b - r2 + ri * ri; if (disc > 0) tIn = Math.max(0, -b - Math.sqrt(disc)); }
        const tExit = tIn < tOut ? tIn : tOut;
        const t = -Math.log(1 - rand()) / maj[si];
        if (t < tExit) {
          px += dx * t; py += dy * t; pz += dz * t;
          r = Math.hypot(px, py, pz); h = Math.max(0, r - RG);
          const sT = bR * air.rhoR(h) + bMe * (air.rhoB(h) + air.rhoU(h)) + bO * air.rhoO(h);
          if (rand() * maj[si] < sT) { hit = 1; break; }
        } else {
          px += dx * tExit; py += dy * tExit; pz += dz * tExit;
          if (tIn < tOut) { if (--si < 0) { hit = 2; break; } } else { if (++si >= NS) { hit = 3; break; } }
        }
      }
      if (hit === 3) return;
      if (order === 1 && hit === 2) acc = accSurface;   // the ray's own end: the surface's light, apart from the air's
      const oi = order <= NORD ? order - 1 : NORD - 1;
      if (hit === 2) {
        r = Math.hypot(px, py, pz);
        const nx = px / r, ny = py / r, nz = pz / r;
        px = nx * RG; py = ny * RG; pz = nz * RG; si = 0;
        let lambert = albedo(w);
        if (ground === 'sea') {
          const ci = Math.min(1, Math.max(0, -(dx * nx + dy * ny + dz * nz)));
          const n = 1.34, st = Math.sqrt(1 - ci * ci) / n, ct = Math.sqrt(Math.max(0, 1 - st * st));
          const rs = (ci - n * ct) / (ci + n * ct), rp = (n * ci - ct) / (n * ci + ct), R = 0.5 * (rs * rs + rp * rp);
          const aw = water(w), sum = R + aw;
          if (sum <= 0) return;
          thr *= sum;
          if (rand() * sum < R) {   // the mirror: no sun in it (its glint is left out)
            const k = 2 * ci; dx += k * nx; dy += k * ny; dz += k * nz;
            order++;
            continue;
          }
          lambert = 1;   // the water's own light: its albedo is in thr already
        }
        if (lambert <= 0) return;
        thr *= lambert;
        const mus = nx * sx + ny * sy + nz * sz;
        if (mus > 0 && (order > 1 || firstNEE)) acc[oi] += thr * mus / Math.PI * sunT(w, RG, mus);
        // A cosine-weighted direction about the normal.
        const u1 = rand(), u2 = rand(), sr = Math.sqrt(u1), ph = 2 * Math.PI * u2, cz = Math.sqrt(1 - u1);
        let tx, ty, tz;
        if (Math.abs(nx) < 0.9) { tx = 0; ty = -nz; tz = ny; } else { tx = nz; ty = 0; tz = -nx; }
        const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
        const ux = ny * tz - nz * ty, uy = nz * tx - nx * tz, uz = nx * ty - ny * tx;
        const a = sr * Math.cos(ph), b2 = sr * Math.sin(ph);
        dx = a * tx + b2 * ux + cz * nx; dy = a * ty + b2 * uy + cz * ny; dz = a * tz + b2 * uz + cz * nz;
      } else {
        const sR = bR * air.rhoR(h), sB = bM * air.rhoB(h), sU = bM * air.rhoU(h), sS = sR + sB + sU;
        const sT = sR + air.mieExt * (sB + sU) + bO * air.rhoO(h);
        thr *= sS / sT;
        if (order > 1 || firstNEE) {
          const mus = (px * sx + py * sy + pz * sz) / r, T = sunT(w, r, mus);
          if (T > 0) {
            const c = dx * sx + dy * sy + dz * sz;
            acc[oi] += thr * T * (sR * P.phaseR(c) + sB * P.phaseM(c) + sU * P.phaseUp(c)) / sS;
          }
        }
        // A new direction from the phase function of the species that scatters.
        const u = rand() * sS;
        let mu;
        if (u < sR) {
          do { mu = 2 * rand() - 1; } while (rand() * 2 > 1 + mu * mu);
        } else {
          const g = u < sR + sB ? (rand() < wSharp ? g1 : g2) : gU;
          do {
            const q = (1 - g * g) / (1 - g + 2 * g * rand());
            mu = (1 + g * g - q * q) / (2 * g);
          } while (rand() * 2 > 1 + mu * mu);
        }
        const st = Math.sqrt(Math.max(0, 1 - mu * mu)), ph = 2 * Math.PI * rand();
        let tx, ty, tz;
        if (Math.abs(dx) < 0.9) { tx = 0; ty = -dz; tz = dy; } else { tx = dz; ty = 0; tz = -dx; }
        const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
        const ux = dy * tz - dz * ty, uy = dz * tx - dx * tz, uz = dx * ty - dy * tx;
        const a = st * Math.cos(ph), b2 = st * Math.sin(ph);
        const nx = a * tx + b2 * ux + mu * dx, ny = a * ty + b2 * uy + mu * dy, nz = a * tz + b2 * uz + mu * dz;
        const nl = Math.hypot(nx, ny, nz);
        dx = nx / nl; dy = ny / nl; dz = nz / nl;
      }
      order++;
      if (order > 6) {             // Russian roulette
        const q = Math.min(1, thr * 4);
        if (q < 1) { if (rand() >= q) return; thr /= q; }
      }
      if (order > 400) return;
    }
  }

  // The light scattered once along a view ray, by quadrature: per wavelength
  // [air, aerosol, ground], and the ray's transmittance to its end.
  function once(o, d, s, N = 6000) {
    const NW = P.NW;
    const r0 = Math.hypot(...o), b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
    const dg = b * b - r0 * r0 + RG * RG, hitG = b < 0 && dg > 0;
    const tmax = hitG ? -b - Math.sqrt(dg) : -b + Math.sqrt(Math.max(0, b * b - r0 * r0 + air.RT * air.RT));
    const R = new Float64Array(NW), M = new Float64Array(NW), G = new Float64Array(NW), T = new Float64Array(NW);
    const c = d[0] * s[0] + d[1] * s[1] + d[2] * s[2], pR = P.phaseR(c), pM = P.phaseM(c), pU = P.phaseUp(c);
    let a0 = 0, a1 = 0, a2 = 0;
    const dt = tmax / N;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) * dt, px = o[0] + d[0] * t, py = o[1] + d[1] * t, pz = o[2] + d[2] * t;
      const r = Math.hypot(px, py, pz), h = Math.max(0, r - RG);
      const dR = air.rhoR(h) * dt, dB = air.rhoB(h) * dt, dU = air.rhoU(h) * dt, dO = air.rhoO(h) * dt;
      a0 += 0.5 * dR; a1 += 0.5 * (dB + dU); a2 += 0.5 * dO;
      const mus = (px * s[0] + py * s[1] + pz * s[2]) / r, lit = dep.depth(r, mus, ds);
      if (lit) {
        const scr = Math.exp(-screenDepth(r, mus));
        for (let w = 0; w < NW; w++) {
          const tr = scr * Math.exp(-(air.bR[w] * (a0 + ds[0]) + air.bMe[w] * (a1 + ds[1]) + air.bO[w] * (a2 + ds[2])));
          R[w] += tr * air.bR[w] * dR * pR;
          M[w] += tr * air.bM[w] * (dB * pM + dU * pU);
        }
      }
      a0 += 0.5 * dR; a1 += 0.5 * (dB + dU); a2 += 0.5 * dO;
    }
    for (let w = 0; w < NW; w++) T[w] = Math.exp(-(air.bR[w] * a0 + air.bMe[w] * a1 + air.bO[w] * a2));
    if (hitG && ground === 'lambert') {
      const px = o[0] + d[0] * tmax, py = o[1] + d[1] * tmax, pz = o[2] + d[2] * tmax;
      const mus = (px * s[0] + py * s[1] + pz * s[2]) / RG;
      if (mus > 0 && dep.depth(RG, mus, ds)) {
        for (let w = 0; w < NW; w++) {
          G[w] = T[w] * albedo(w) * mus / Math.PI * Math.exp(-(air.bR[w] * ds[0] + air.bMe[w] * ds[1] + air.bO[w] * ds[2]) - screenDepth(RG, mus));
        }
      }
    }
    return { R, M, G, T, hitG, tmax };
  }

  return { path, once, sunT, dep, majs, screenDepth };
}

export const dirOf = (elDeg, azDeg) => {
  const e = elDeg * Math.PI / 180, a = azDeg * Math.PI / 180;
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
};
