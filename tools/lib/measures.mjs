// Measures of a still for the look invariants (tools/look.json): pure functions of an { w, h, rgb } picture
// (8-bit sRGB, as readPng gives) and the options of a registry entry. Each returns one number. What each can
// and cannot tell is in tools/README.md ("look").
export const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// The pixels of a region [x, y, w, h] (fractions of the picture), as Float32Array planes l (luma), r, g, b.
export function region(img, box = [0, 0, 1, 1]) {
  const x0 = Math.round(box[0] * img.w), y0 = Math.round(box[1] * img.h);
  const w = Math.max(1, Math.min(img.w - x0, Math.round(box[2] * img.w))), h = Math.max(1, Math.min(img.h - y0, Math.round(box[3] * img.h)));
  const n = w * h, l = new Float32Array(n), r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y0 + y) * img.w + x0 + x) * 3, i = y * w + x;
      r[i] = img.rgb[s]; g[i] = img.rgb[s + 1]; b[i] = img.rgb[s + 2];
      l[i] = luma(r[i], g[i], b[i]);
    }
  }
  return { w, h, l, r, g, b };
}

const sorted = (arr) => Float32Array.from(arr).sort();
const at = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p / 100 * (s.length - 1))))];
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const median = (a) => (a.length ? at(sorted(a), 50) : 0);

// The cloud mask of a region: pixels at least `cloudLuma` in luma whose saturation ((max - min) / max of r, g,
// b) is at most `cloudSat`. A rough mask: grey haze near the horizon passes it, and so does a white glitter.
export function cloudMask(R, { cloudLuma: min = 120, cloudSat: sat = 0.22 } = {}) {
  const m = new Uint8Array(R.l.length);
  for (let i = 0; i < m.length; i++) {
    const hi = Math.max(R.r[i], R.g[i], R.b[i]), lo = Math.min(R.r[i], R.g[i], R.b[i]);
    m[i] = R.l[i] >= min && hi > 0 && (hi - lo) / hi <= sat ? 1 : 0;
  }
  return m;
}

// lumaPct: the p-th percentile (default 50) of the luma (0 to 255, as shown) in the region.
export function lumaPct(img, { region: box, p = 50 } = {}) {
  return at(sorted(region(img, box).l), p);
}

// The brightest pixels of the region (luma at or over the p-th percentile, default 95): their mean r/g (rg),
// b/g (bg), or saturation (sat), by opt.of. Sunlit cloud tops: near 1, 1 and 0 when white.
export function brightColour(img, { region: box, p = 95, of = 'sat' } = {}) {
  const R = region(img, box), cut = at(sorted(R.l), p);
  const v = [];
  for (let i = 0; i < R.l.length; i++) {
    if (R.l[i] < cut || R.g[i] <= 0) continue;
    const hi = Math.max(R.r[i], R.g[i], R.b[i]), lo = Math.min(R.r[i], R.g[i], R.b[i]);
    v.push(of === 'rg' ? R.r[i] / R.g[i] : of === 'bg' ? R.b[i] / R.g[i] : (hi - lo) / hi);
  }
  return mean(v);
}

// cover: the share of the region in the cloud mask (opt.cloudLuma, opt.cloudSat as in cloudMask).
export function cover(img, opt = {}) {
  const m = cloudMask(region(img, opt.region), opt);
  return mean(m);
}

// coverRise and coverFall, of a sweep (a list of pictures, the slider's steps in order): the largest rise and the
// largest fall of the cover (above) between neighbouring pictures. A field that grows steadily: small rises, no fall.
const coverSteps = (imgs, opt) => {
  const c = imgs.map((img) => cover(img, opt)), d = c.slice(1).map((v, i) => v - c[i]);
  return d.length ? d : [0];
};
export const coverRise = (imgs, opt = {}) => Math.max(0, ...coverSteps(imgs, opt));
export const coverFall = (imgs, opt = {}) => Math.max(0, ...coverSteps(imgs, opt).map((v) => -v));

// exposureStep, of a sweep: the largest change of the exposure the page showed the pictures at (img.exposure,
// window.__exposure, log2: stops) between neighbouring pictures. A sweep of the sun's height: no jump.
export function exposureStep(imgs) {
  const x = imgs.map((img) => img.exposure);
  if (x.some((v) => typeof v !== 'number')) throw new Error('exposureStep: a still without its exposure (window.__exposure)');
  return Math.max(0, ...x.slice(1).map((v, i) => Math.abs(v - x[i])));
}

// flatPlate: the largest connected part (4 neighbours) of the bright pixels (luma at least opt.luma, 150) whose
// local relief is very low (the mean of |dx| + |dy| of the luma over a box of opt.k px, 7, under opt.grad, 3
// levels), as a share of the region. Cloud tops are knobbly; a flat pale plate (a closed floor without the relief
// of a sheet over it) is one large smooth part.
export function flatPlate(img, opt = {}) {
  const R = region(img, opt.region), { w, h, l } = R, lum = opt.luma ?? 150, gmax = opt.grad ?? 3, k = opt.k ?? 7;
  const g = new Float64Array((w + 1) * (h + 1));
  // (An integral image of the relief, for the box mean.)
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      row += (x + 1 < w ? Math.abs(l[i + 1] - l[i]) : 0) + (y + 1 < h ? Math.abs(l[i + w] - l[i]) : 0);
      g[(y + 1) * (w + 1) + x + 1] = g[y * (w + 1) + x + 1] + row;
    }
  }
  const m = new Uint8Array(w * h), r = k >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      const s = g[y1 * (w + 1) + x1] - g[y0 * (w + 1) + x1] - g[y1 * (w + 1) + x0] + g[y0 * (w + 1) + x0];
      m[y * w + x] = l[y * w + x] >= lum && s / ((x1 - x0) * (y1 - y0)) < gmax ? 1 : 0;
    }
  }
  let best = 0;
  const stack = new Int32Array(w * h);
  for (let i0 = 0; i0 < w * h; i0++) {
    if (m[i0] !== 1) continue;
    let n = 0, top = 0;
    stack[top++] = i0;
    m[i0] = 2;
    while (top) {
      const i = stack[--top], x = i % w;
      n++;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < w * h && m[j] === 1) { m[j] = 2; stack[top++] = j; }
      }
    }
    best = Math.max(best, n);
  }
  return best / (w * h);
}

// clumping: how unevenly the clouds lie over the region: the cover of the cloud mask in each window of a grid of
// opt.nx by opt.ny (default 8 by 5), the standard deviation over the windows, over their mean. An even sprinkle of
// heaps: low; clusters with clear lanes between: high.
export function clumping(img, opt = {}) {
  const R = region(img, opt.region), m = cloudMask(R, opt), nx = opt.nx || 8, ny = opt.ny || 5, c = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x0 = Math.floor(i * R.w / nx), x1 = Math.floor((i + 1) * R.w / nx), y0 = Math.floor(j * R.h / ny), y1 = Math.floor((j + 1) * R.h / ny);
      let s = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) s += m[y * R.w + x];
      c.push(s / Math.max(1, (x1 - x0) * (y1 - y0)));
    }
  }
  const mu = mean(c);
  return mu > 0 ? Math.sqrt(mean(c.map(v => (v - mu) * (v - mu)))) / mu : 0;
}

// The luma of a window with its plane (a linear slope of brightness) taken out, as a zero-mean field.
function detrend(R, x0, y0, n) {
  const f = new Float64Array(n * n);
  let sv = 0, sxv = 0, syv = 0, sxx = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = R.l[(y0 + y) * R.w + x0 + x], u = x - (n - 1) / 2, w = y - (n - 1) / 2;
    f[y * n + x] = v; sv += v; sxv += u * v; syv += w * v; sxx += u * u;
  }
  const m = sv / (n * n), ax = sxv / sxx, ay = syv / sxx;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f[y * n + x] -= m + ax * (x - (n - 1) / 2) + ay * (y - (n - 1) / 2);
  return f;
}

// An in-place radix-2 FFT of n complex values (re, im), n a power of 2; inverse when inv.
function fft(re, im, inv = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
function fft2(re, im, n, inv) {
  const rr = new Float64Array(n), ri = new Float64Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < n; j++) { const i = pass ? j * n + k : k * n + j; rr[j] = re[i]; ri[j] = im[i]; }
      fft(rr, ri, inv);
      for (let j = 0; j < n; j++) { const i = pass ? j * n + k : k * n + j; re[i] = rr[j]; im[i] = ri[j]; }
    }
  }
}

// The autocorrelation of a zero-mean n x n field at lags -n/2 < dx, dy < n/2, normalised to 1 at lag 0 (each
// lag divided by the number of pixel pairs it has, so that large lags are not damped). acf(dx, dy) reads it.
export function autocorrelation(f, n) {
  const m = 2 * n, re = new Float64Array(m * m), im = new Float64Array(m * m);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) re[y * m + x] = f[y * n + x];
  fft2(re, im, m, false);
  for (let i = 0; i < re.length; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  fft2(re, im, m, true);
  const c0 = re[0];
  return (dx, dy) => (c0 > 0 ? re[((dy + m) % m) * m + ((dx + m) % m)] / c0 * (n * n) / ((n - Math.abs(dx)) * (n - Math.abs(dy))) : 0);
}

// Square windows of side n laid over the region, cols x rows of them (as many as fit, at most 4 x 3).
function windows(R, n) {
  const cols = Math.min(4, Math.floor(R.w / n)), rows = Math.min(3, Math.floor(R.h / n)), out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    out.push([Math.round(cols > 1 ? i * (R.w - n) / (cols - 1) : (R.w - n) / 2), Math.round(rows > 1 ? j * (R.h - n) / (rows - 1) : (R.h - n) / 2)]);
  }
  return out;
}
const pow2 = (v) => 2 ** Math.floor(Math.log2(v));

// The rebound of an autocorrelation: over every lag L up to `reach` px, how far acf(L) climbs back above the
// lowest value on the straight way from 0 to L. A field that repeats (rows, a lattice of cells) has its
// autocorrelation fall below zero between repeats and rise again at each repeat: a rebound near 1. Natural
// cloud, whose autocorrelation falls without coming back, gives a small one (the noise of the estimate).
export function rebound(acf, reach) {
  let best = 0;
  for (let dy = 0; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const L = Math.hypot(dx, dy);
      if (L < 3 || L > reach || (dy === 0 && dx < 0)) continue;
      const v = acf(dx, dy);
      if (v + 1 <= best) continue;   // v - lo is at most v + 1
      let lo = 1;
      for (let s = 1; s < L; s++) lo = Math.min(lo, acf(Math.round(dx * s / L), Math.round(dy * s / L)));
      best = Math.max(best, v - lo);
    }
  }
  return best;
}

// regularity: the largest rebound of the autocorrelation of the luma over windows of the region (windows of
// side opt.n px, default the largest power of 2 up to a third of the region's height, at most 128; lags up to
// half of it). The max over windows: a lattice in one part of the view is enough. Perspective changes the
// period across the picture, which is why each window is measured alone.
export function regularity(img, { region: box, n } = {}) {
  const R = region(img, box);
  n = n || Math.min(128, pow2(Math.min(R.w, R.h) / 1.5));
  let best = 0;
  for (const [x, y] of windows(R, n)) best = Math.max(best, rebound(autocorrelation(detrend(R, x, y, n), n), n / 2 - 1));
  return best;
}

// spectrumPeak: the sharpest peak of the power spectrum of the luma, over windows of the region (as
// regularity's, under a Hann window): the power of a frequency over the median of the frequencies about it
// (within `k` bins each way, default 4), the largest over the periods of `pmin` to `pmax` px (6 to 40) and over
// the windows. A pattern that repeats exactly (a tile of noise shown again and again) puts its power in single
// frequencies, tens of times over their neighbours'; natural cloud spreads it, and its largest is the chance
// of one periodogram (10 to 25). It needs several repeats in a window, and tells a tile that the rebound of
// the autocorrelation misses when the tile's content is irregular.
export function spectrumPeak(img, { region: box, n, pmin = 6, pmax = 40, k = 4 } = {}) {
  const R = region(img, box);
  n = n || Math.min(128, pow2(Math.min(R.w, R.h) / 1.5));
  const hann = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / n));
  let best = 0;
  for (const [x, y] of windows(R, n)) {
    const f = detrend(R, x, y, n), re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) re[j * n + i] = f[j * n + i] * hann[i] * hann[j];
    fft2(re, im, n, false);
    const P = (u, v) => { const i = ((v + n) % n) * n + ((u + n) % n); return re[i] * re[i] + im[i] * im[i]; };
    const near = new Float64Array((2 * k + 1) ** 2);
    for (let v = 0; v <= n / pmin; v++) {
      for (let u = -Math.floor(n / pmin); u <= n / pmin; u++) {
        const r = Math.hypot(u, v);
        if (r < n / pmax || r > n / pmin || (v === 0 && u < 0)) continue;
        let c = 0;
        for (let b = -k; b <= k; b++) for (let a = -k; a <= k; a++) near[c++] = P(u + a, v + b);
        const med = median(near);
        if (med > 0) best = Math.max(best, P(u, v) / med);
      }
    }
  }
  return best;
}

// detailScale: the typical size of the detail, as a share of the picture's width: over windows of the region,
// the median of the lag (px) at which the radial mean of the autocorrelation first falls below 0.5, divided by
// the picture's width. Larger blobs, smoother clouds: larger.
export function detailScale(img, { region: box, n } = {}) {
  const R = region(img, box);
  n = n || Math.min(128, pow2(Math.min(R.w, R.h) / 1.5));
  const half = [];
  for (const [x, y] of windows(R, n)) {
    const acf = autocorrelation(detrend(R, x, y, n), n);
    let r = n / 2;
    for (let k = 1; k < n / 2; k++) {
      let s = 0, c = 0;
      for (let a = 0; a < 16; a++) { s += acf(Math.round(k * Math.cos(a * Math.PI / 8)), Math.round(k * Math.sin(a * Math.PI / 8))); c++; }
      if (s / c < 0.5) { r = k; break; }
    }
    half.push(r);
  }
  return median(half) / img.w;
}

// Connected components (4-neighbour) of a 0/1 mask of w x h: their areas in px.
export function blobs(mask, w, h) {
  const label = new Int32Array(w * h), areas = [], stack = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    let area = 0;
    label[i] = areas.length + 1;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      area++;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && mask[q] && !label[q]) { label[q] = areas.length + 1; stack.push(q); }
      }
    }
    areas.push(area);
  }
  return areas;
}

// blobSize: the size of the clouds: the connected parts of the cloud mask (opt.cloudLuma, opt.cloudSat), the mean of
// their areas weighted by area (the size of the cloud a pixel of cloud belongs to), as a share of the region.
// Larger, merged heaps: larger. Meant for views down onto clouds over the sea, where the mask is clean.
export function blobSize(img, opt = {}) {
  const R = region(img, opt.region), a = blobs(cloudMask(R, opt), R.w, R.h);
  const s = a.reduce((x, v) => x + v, 0);
  return s ? a.reduce((x, v) => x + v * v, 0) / s / (R.w * R.h) : 0;
}

// The luma's local contrast: luma minus its box mean over (2k+1)^2 px, divided by the region's median luma.
function highPass(R, k) {
  const { w, h, l } = R, I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) I[(y + 1) * (w + 1) + x + 1] = l[y * w + x] + I[y * (w + 1) + x + 1] + I[(y + 1) * (w + 1) + x] - I[y * (w + 1) + x];
  const out = new Float32Array(w * h), m = Math.max(1, median(l));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - k), x1 = Math.min(w, x + k + 1), y0 = Math.max(0, y - k), y1 = Math.min(h, y + k + 1);
    const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    out[y * w + x] = (l[y * w + x] - s / ((x1 - x0) * (y1 - y0))) / m;
  }
  return out;
}

// Specks: the blobs of the region darker (opt.dark, default true) or brighter than their surroundings (the
// local contrast over a box of opt.k px, default 8, beyond opt.t, default 0.06), of at least 4 px. specksCv is
// the coefficient of variation of their areas: a field of equal specks gives a small one, natural detail of
// every size a large one. speckDensity is their count per 10 000 px of the region.
function specks(img, { region: box, k = 8, t = 0.06, dark = true } = {}) {
  const R = region(img, box), hp = highPass(R, k), m = new Uint8Array(hp.length);
  for (let i = 0; i < m.length; i++) m[i] = dark ? hp[i] < -t : hp[i] > t;
  return { areas: blobs(m, R.w, R.h).filter((a) => a >= 4), n: R.w * R.h };
}
export function specksCv(img, opt = {}) {
  const { areas } = specks(img, opt);
  if (areas.length < 5) return 9;
  const mu = mean(areas), sd = Math.sqrt(mean(areas.map((a) => (a - mu) ** 2)));
  return sd / mu;
}
export function speckDensity(img, opt = {}) {
  const { areas, n } = specks(img, opt);
  return areas.length / n * 1e4;
}

// verticalWalls: the share of the strong edges of the region (gradient of the luma over the opt.p-th
// percentile, default 90, and at least 8 levels) that are near-vertical (within about 15 degrees) and lie in
// a vertical run of at least opt.run px (default 4 % of the picture's height). Walls and needles, which
// natural heaps seen from above have little of, give a large share.
export function verticalWalls(img, { region: box, p = 90, run } = {}) {
  const R = region(img, box), { w, h, l } = R;
  run = run || Math.max(6, Math.round(0.04 * img.h));
  const mag = new Float32Array(w * h), vert = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = l[i - w + 1] + 2 * l[i + 1] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - 1] - l[i + w - 1];
    const gy = l[i + w - 1] + 2 * l[i + w] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - w] - l[i - w + 1];
    mag[i] = Math.hypot(gx, gy) / 4;
    vert[i] = Math.abs(gx) > 3.7 * Math.abs(gy) ? 1 : 0;
  }
  const cut = Math.max(8, at(sorted(mag), p));
  const strong = new Uint8Array(w * h);
  let nStrong = 0;
  for (let i = 0; i < mag.length; i++) if (mag[i] >= cut) { strong[i] = 1; nStrong++; }
  // Vertical runs: a strong near-vertical edge pixel continues in the row below within one column.
  const len = new Int32Array(w * h);
  for (let y = h - 2; y >= 1; y--) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!(strong[i] && vert[i])) continue;
    let below = 0;
    for (const d of [-1, 0, 1]) { const j = i + w + d; if (strong[j] && vert[j]) below = Math.max(below, len[j]); }
    len[i] = below + 1;
  }
  // Mark the pixels of each run that reaches `run`, from its top down.
  let inWalls = 0;
  const mark = new Uint8Array(w * h);
  for (let i = 0; i < len.length; i++) {
    if (len[i] < run || mark[i]) continue;
    for (let j = i, k = len[i]; k > 0; k--) {
      if (!mark[j]) { mark[j] = 1; inWalls++; }
      let next = -1, best = 0;
      for (const d of [-1, 0, 1]) { const q = j + w + d; if (q < len.length && len[q] > best && len[q] === k - 1) { best = len[q]; next = q; } }
      if (next < 0) break;
      j = next;
    }
  }
  return nStrong ? inWalls / nStrong : 0;
}

// edgeRatio: the luma's horizontal gradient against its vertical one over the region (sum of |d/dx| over sum of
// |d/dy|, Sobel). Clouds seen obliquely are wider than tall and shaded from above: below 1. Walls, needles and
// columns shaded side by side (vertical stripes) raise it.
export function edgeRatio(img, { region: box } = {}) {
  const { w, h, l } = region(img, box);
  let sx = 0, sy = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    sx += Math.abs(l[i - w + 1] + 2 * l[i + 1] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - 1] - l[i + w - 1]);
    sy += Math.abs(l[i + w - 1] + 2 * l[i + w] + l[i + w + 1] - l[i - w - 1] - 2 * l[i - w] - l[i - w + 1]);
  }
  return sy ? sx / sy : 0;
}

// relief: the mean gradient of the luma inside the cloud mask (opt.cloudLuma, opt.cloudSat), at scales 1, 2 and 4 (the
// picture averaged over 1, 2 and 4 px squares), each divided by the mean luma of the mask, then averaged.
// Clouds with knobs, shade and folds: high; smooth plastic or flat cotton: low.
export function relief(img, opt = {}) {
  const R = region(img, opt.region), m = cloudMask(R, opt), res = [];
  for (const s of [1, 2, 4]) {
    const w = Math.floor(R.w / s), h = Math.floor(R.h / s), L = new Float32Array(w * h), M = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = 0, c = 0;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) { const q = (y * s + j) * R.w + x * s + i; v += R.l[q]; c += m[q]; }
      L[y * w + x] = v / (s * s);
      M[y * w + x] = c === s * s ? 1 : 0;
    }
    let g = 0, lum = 0, n = 0;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      if (!(M[i] && M[i + 1] && M[i + w])) continue;
      g += Math.hypot(L[i + 1] - L[i], L[i + w] - L[i]);
      lum += L[i];
      n++;
    }
    if (n) res.push(g / lum);
  }
  return res.length ? mean(res) : 0;
}

// lineDip: a thin dark line across the region: the region is cut into opt.cols vertical strips (default 8);
// for each row y, the dip of each strip's mean luma at rows y and y + 1 (the darker) below the rows on both
// sides (the lower of the medians of rows y - k .. y - 2 and y + 2 .. y + k, opt.k default 4), as a share of
// it; the measure is the largest over rows of the median over strips. A line of one or two rows across the
// width dips in every strip at the same row; the edge of a cloud is dark on one side only, and one cloud's
// dark seam is in one strip only.
export function lineDip(img, { region: box, cols = 8, k = 4 } = {}) {
  const R = region(img, box), sw = Math.floor(R.w / cols);
  const rows = Array.from({ length: cols }, (_, c) => {
    const a = new Float32Array(R.h);
    for (let y = 0; y < R.h; y++) { let s = 0; for (let x = c * sw; x < (c + 1) * sw; x++) s += R.l[y * R.w + x]; a[y] = s / sw; }
    return a;
  });
  let best = 0;
  for (let y = k; y < R.h - k; y++) {
    const dips = rows.map((a) => {
      const up = [], down = [];
      for (let j = 2; j <= k; j++) { up.push(a[y - j]); down.push(a[y + j]); }
      const m = Math.min(median(up), median(down));
      return m > 1 ? (m - Math.min(a[y], a[y + 1])) / m : 0;
    });
    best = Math.max(best, median(dips));
  }
  return best;
}

// columnJump: a straight seam down the region: the mean luma of each column, and the largest step between
// neighbouring columns, in levels. A seam fixed in the world that a view crosses upright steps at one column; the
// edges of clouds, which wander, step a little in many.
export function columnJump(img, { region: box } = {}) {
  const R = region(img, box), c = new Float32Array(R.w);
  for (let x = 0; x < R.w; x++) { let s = 0; for (let y = 0; y < R.h; y++) s += R.l[y * R.w + x]; c[x] = s / R.h; }
  let best = 0;
  for (let x = 1; x < R.w; x++) best = Math.max(best, Math.abs(c[x] - c[x - 1]));
  return best;
}

// The points of light of a region (R, from region()): pixels at least t levels of luma above the mean of their
// surroundings ((2k+1)^2 px) and the brightest in their 5 x 5 px, each { x, y, over } (over: levels above that mean).
function lightPoints(R, k, t) {
  const { w, h, l } = R, I = new Float64Array((w + 1) * (h + 1)), out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) I[(y + 1) * (w + 1) + x + 1] = l[y * w + x] + I[y * (w + 1) + x + 1] + I[(y + 1) * (w + 1) + x] - I[y * (w + 1) + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = l[y * w + x];
    const x0 = Math.max(0, x - k), x1 = Math.min(w, x + k + 1), y0 = Math.max(0, y - k), y1 = Math.min(h, y + k + 1);
    const s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
    const over = v - s / ((x1 - x0) * (y1 - y0));
    if (over < t) continue;
    let top = true;
    for (let dy = -2; dy <= 2 && top; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if ((dx || dy) && xx >= 0 && yy >= 0 && xx < w && yy < h && (l[yy * w + xx] > v || (l[yy * w + xx] === v && yy * w + xx < y * w + x))) { top = false; break; }
    }
    if (top) out.push({ x, y, over });
  }
  return out;
}

// stars: the points of light the region shows, per 10 000 px: pixels at least opt.t levels (default 12) of luma
// above the mean of their surroundings ((2k+1)^2 px, opt.k default 4), and the brightest in their 5 x 5 px. In
// levels as shown, not relative to the region: a star the screen shows 12 levels over a black sky is seen, one
// 3 levels over it is not.
export function stars(img, { region: box, k = 4, t = 12 } = {}) {
  const R = region(img, box);
  return lightPoints(R, k, t).length / (R.w * R.h) * 1e4;
}

// starShape: how drawn out the brightest points of light are. For each of the opt.n (default 12) points of
// `stars` that stand furthest over their surroundings (opt.t default 30), in a window of (2r+1)^2 px (opt.r
// default 6): the luma over the median of the window's rim, where it is at least a quarter of the point's own;
// the ratio of the long axis of its second moments to the short one (each at least 0.08 px^2, about a
// pixel's). The median over the points: a point 1.1 to 1.4, a streak 2 and more.
export function starShape(img, { region: box, k = 4, t = 30, n = 12, r = 6 } = {}) {
  const R = region(img, box), { w, h, l } = R;
  const pts = lightPoints(R, k, t).filter((p) => p.x >= r && p.y >= r && p.x < w - r && p.y < h - r);
  pts.sort((a, b) => b.over - a.over);
  const ratios = [];
  for (const p of pts.slice(0, n)) {
    const rim = [];
    for (let d = -r; d <= r; d++) rim.push(l[(p.y - r) * w + p.x + d], l[(p.y + r) * w + p.x + d], l[(p.y + d) * w + p.x - r], l[(p.y + d) * w + p.x + r]);
    const bg = median(rim), peak = l[p.y * w + p.x] - bg;
    let s = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const v = l[(p.y + dy) * w + p.x + dx] - bg;
      if (v < 0.25 * peak) continue;
      s += v; sx += v * dx; sy += v * dy; sxx += v * dx * dx; syy += v * dy * dy; sxy += v * dx * dy;
    }
    const cx = sx / s, cy = sy / s, a = sxx / s - cx * cx, c = syy / s - cy * cy, b = sxy / s - cx * cy;
    const m = (a + c) / 2, q = Math.sqrt(((a - c) / 2) ** 2 + b * b);
    ratios.push(Math.sqrt(Math.max(m + q, 1e-6) / Math.max(m - q, 0.08)));
  }
  return median(ratios);
}

export const MEASURES = { lumaPct, brightColour, cover, coverRise, coverFall, exposureStep, flatPlate, clumping, regularity, spectrumPeak, detailScale, specksCv, speckDensity, verticalWalls, edgeRatio, relief, blobSize, lineDip, columnJump, stars, starShape };
