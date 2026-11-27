// The page's model of the air, taken from index.html itself (its constants,
// density profiles and phase functions, and its own tables to compare), for
// the reference solver (mc.mjs). The reference uses none of the page's
// approximations: only the constants and the profiles.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// This repository's page.
export const PAGE = fileURLToPath(new URL('../../index.html', import.meta.url));

export function loadPage(indexPath = PAGE) {
  const text = fs.readFileSync(indexPath, 'utf8');
  const a = text.indexOf('// ---------- The atmosphere (the same model as the shader) ----------');
  const b = text.indexOf('// Axes: x west, y up, z south.');
  if (a < 0 || b < 0) throw new Error('atmosphere block not found in ' + indexPath);
  const src = text.slice(a, b) + `
  return { RG, RT, HR, BETA_M, MIE_EXT, ALBEDO, BL, MIE_PHASE, MIE_G_UP, ANGSTROM, phaseR, cornetteShanks, phaseM, phaseUp,
    AERO_UP, boundaryLayer, mieUp, mieDensity, NW, WL, SOLAR, OZONE, CMF, BR, MA, BO, W, WY, buildDepths, sunDepth,
    buildMultiScatter, msData, upData, msIndex, leanIndex, NMU, NH, MS_MU_MIN, odTable,
    msFall: typeof msFall === 'undefined' ? null : msFall, shapeIndex: typeof shapeIndex === 'undefined' ? null : shapeIndex,
    SHAPE_W: typeof SHAPE_W === 'undefined' ? null : SHAPE_W };`;
  return new Function(src)();
}

// The reference's own atmosphere: densities by height, from the page's
// constants. opts: { haze, ozone (factor), mieExt, bl: fn or null }.
export function makeAir(P, opts = {}) {
  const haze = opts.haze ?? 1, ozone = opts.ozone ?? 1, mieExt = opts.mieExt ?? P.MIE_EXT;
  const RG = P.RG, RT = P.RT, HTOP = RT - RG;
  const blF = opts.boundaryLayer ?? P.boundaryLayer;
  const up = P.AERO_UP;
  const air = {
    P, RG, RT, HTOP, haze, mieExt,
    bR: P.BR.slice(), bM: P.MA.map(m => P.BETA_M * haze * m), bO: P.BO.map(o => o * ozone),
    rhoR: h => Math.exp(-h / P.HR),
    rhoB: h => blF(h),
    rhoU: h => up[0][0] * Math.exp(-(((h - up[0][1]) / up[0][2]) ** 2)) + up[1][0] * Math.exp(-(((h - up[1][1]) / up[1][2]) ** 2)),
    rhoO: h => Math.max(0, 1 - Math.abs(h - 25) / 15),
  };
  air.bMe = air.bM.map(b => b * mieExt);
  return air;
}

// Optical depth per species (Rayleigh, aerosol, ozone) from height h along a
// ray of zenith cosine mu to the top of the air: a table for mu >= 0, the
// rest by symmetry about the ray's lowest point. A ray that meets the
// planet has none (null).
export function makeDepth(air, NHT = 700, NMT = 768, STEPS = 320) {
  const { RG, RT, HTOP } = air;
  const tab = new Float64Array(NHT * NMT * 3);
  const P = 2.5;
  for (let j = 0; j < NHT; j++) {
    const h = HTOP * (j / (NHT - 1)) ** P, r = RG + h;
    for (let i = 0; i < NMT; i++) {
      const x = i / (NMT - 1), mu = x * x, s2 = 1 - mu * mu;
      const b = r * mu, tmax = -b + Math.sqrt(Math.max(0, b * b - r * r + RT * RT));
      let a = 0, m = 0, o = 0, last = 0;
      for (let s = 0; s < STEPS; s++) {
        const f = (s + 1) / STEPS, t1 = tmax * f * f, dt = t1 - last, t = last + 0.5 * dt;
        last = t1;
        const hh = Math.max(0, Math.sqrt(r * r * s2 + (b + t) * (b + t)) - RG);
        a += air.rhoR(hh) * dt; m += (air.rhoB(hh) + air.rhoU(hh)) * dt; o += air.rhoO(hh) * dt;
      }
      tab.set([a, m, o], (j * NMT + i) * 3);
    }
  }
  const up = (h, mu, out) => {
    const y = Math.min(1, Math.max(0, h / HTOP)) ** (1 / P) * (NHT - 1), x = Math.sqrt(Math.min(1, Math.max(0, mu))) * (NMT - 1);
    const j0 = Math.min(Math.floor(y), NHT - 2), i0 = Math.min(Math.floor(x), NMT - 2), fy = y - j0, fx = x - i0;
    const k = (j0 * NMT + i0) * 3, k2 = k + NMT * 3;
    for (let c = 0; c < 3; c++) {
      out[c] = (tab[k + c] * (1 - fx) + tab[k + 3 + c] * fx) * (1 - fy) + (tab[k2 + c] * (1 - fx) + tab[k2 + 3 + c] * fx) * fy;
    }
  };
  const t0 = [0, 0, 0], t1 = [0, 0, 0];
  // out: the three depths; returns false when the planet is in the way.
  const depth = (r, mu, out) => {
    if (mu >= 0) { up(r - RG, mu, out); return true; }
    const rt = r * Math.sqrt(Math.max(0, 1 - mu * mu));
    if (rt < RG) return false;
    up(rt - RG, 0, t0); up(r - RG, -mu, t1);
    for (let c = 0; c < 3; c++) out[c] = 2 * t0[c] - t1[c];
    return true;
  };
  // The same by a direct fine sum, for checking the table.
  const direct = (r, mu, out, N = 20000) => {
    const b = r * mu, s2 = 1 - mu * mu;
    if (mu < 0 && r * r * s2 < RG * RG) return false;
    const tmax = -b + Math.sqrt(Math.max(0, b * b - r * r + RT * RT)), dt = tmax / N;
    let a = 0, m = 0, o = 0;
    for (let s = 0; s < N; s++) {
      const t = (s + 0.5) * dt, hh = Math.max(0, Math.sqrt(r * r * s2 + (b + t) * (b + t)) - RG);
      a += air.rhoR(hh) * dt; m += (air.rhoB(hh) + air.rhoU(hh)) * dt; o += air.rhoO(hh) * dt;
    }
    out[0] = a; out[1] = m; out[2] = o;
    return true;
  };
  return { depth, direct };
}

// Spectrum (12 values, per unit of the sun's irradiance) to the page's linear
// sRGB before exposure (col in fs: ISUN * W . L).
export const ISUN = 20;
export function toRGB(P, L) {
  return P.W.map(row => ISUN * row.reduce((a, w, i) => a + w * L[i], 0));
}
