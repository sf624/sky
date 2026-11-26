// The same bake on the CPU in plain JavaScript (one thread, Float32Array), to measure what a worker fallback would
// cost where float render targets are missing. Same equation, stencils and RKL1 scheme as index.html.
//
//   node tools/proto/rollbake/cpu.mjs N [S] [T] [OUT.f32] [SEED.f32]
import fs from 'node:fs';

const n = +(process.argv[2] || 512), s = +(process.argv[3] || 40), T = +(process.argv[4] || 150);
const outFile = process.argv[5], seedFile = process.argv[6];
const H = 2 * Math.PI / 8, IH2 = 1 / (H * H), I6H2 = 1 / (6 * H * H), eps = 0.25, a = 0.5;
const m = n - 1, N = n * n;

// The wind's direction (sh.py's wind_angle) as w w^T, per texel.
const wxx = new Float32Array(N), wyy = new Float32Array(N), wxy2 = new Float32Array(N);
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  const th = 0.3 + 0.6 * Math.sin(2 * Math.PI * x / n) + 0.3 * Math.sin(2 * Math.PI * y / n + 1.0);
  const c = Math.cos(th), sn = Math.sin(th), i = y * n + x;
  wxx[i] = a * c * c; wyy[i] = a * sn * sn; wxy2[i] = a * 2 * c * sn * 0.25 * IH2;
}

function lap9(u, out) {
  for (let y = 0; y < n; y++) {
    const r = y * n, rn = ((y + 1) & m) * n, rs = ((y - 1) & m) * n;
    for (let x = 0; x < n; x++) {
      const xe = (x + 1) & m, xw = (x - 1) & m;
      const e = u[r + xe] + u[r + xw] + u[rn + x] + u[rs + x];
      const d = u[rn + xe] + u[rn + xw] + u[rs + xe] + u[rs + xw];
      out[r + x] = (4 * e + d - 20 * u[r + x]) * I6H2;
    }
  }
}

// out = mu y + nu y2 + muw f(y), with L = lap9(y) given.
function stage(y, y2, L, out, mu, nu, muw) {
  for (let j = 0; j < n; j++) {
    const r = j * n, rn = ((j + 1) & m) * n, rs = ((j - 1) & m) * n;
    for (let x = 0; x < n; x++) {
      const xe = (x + 1) & m, xw = (x - 1) & m, i = r + x, v = y[i], l1 = L[i];
      const l2 = (4 * (L[r + xe] + L[r + xw] + L[rn + x] + L[rs + x]) + L[rn + xe] + L[rn + xw] + L[rs + xe] + L[rs + xw] - 20 * l1) * I6H2;
      const uxx = (y[r + xe] + y[r + xw] - 2 * v) * IH2, uyy = (y[rn + x] + y[rs + x] - 2 * v) * IH2;
      const uxy = y[rn + xe] - y[rn + xw] - y[rs + xe] + y[rs + xw];
      const f = eps * v - (v + 2 * l1 + l2) - v * v * v + wxx[i] * uxx + wyy[i] * uyy + wxy2[i] * uxy;
      out[i] = mu * v + nu * y2[i] + muw * f;
    }
  }
}

// The explicit step as in index.html (lambdaMax).
let lm = 0;
for (let i = 0; i <= 96; i++) for (let k = 0; k <= 96; k++) {
  const kx = -Math.PI + 2 * Math.PI * i / 96, ky = -Math.PI + 2 * Math.PI * k / 96, cx = Math.cos(kx), cy = Math.cos(ky);
  const base = (1 + (4 * (2 * cx + 2 * cy) + 4 * cx * cy - 20) / (6 * H * H)) ** 2 - eps;
  for (let t = 0; t < 24; t++) {
    const th = Math.PI * t / 24, wx = Math.cos(th), wy = Math.sin(th);
    lm = Math.max(lm, base + a * (wx * wx * (2 - 2 * cx) + wy * wy * (2 - 2 * cy) + 2 * wx * wy * Math.sin(kx) * Math.sin(ky)) / (H * H));
  }
}
const dts = 0.9 * (2 / lm) * (s * s + s) / 2, nsup = Math.max(1, Math.round(T / dts)), w1 = 2 / (s * s + s);

const f = [0, 1, 2].map(() => new Float32Array(N)), L = new Float32Array(N);
if (seedFile) f[0].set(new Float32Array(fs.readFileSync(seedFile).buffer.slice(0)));
else { let h = 1; for (let i = 0; i < N; i++) { h = (h * 1664525 + 1013904223) >>> 0; f[0][i] = 0.01 * ((h / 4294967296) * 2 - 1) * 1.732; } }
const t0 = performance.now();
let cur = 0, prev = 0;
for (let k = 0; k < nsup; k++) {
  for (let st = 1; st <= s; st++) {
    const ym1 = cur, ym2 = st === 1 ? cur : prev, out = [0, 1, 2].find((i) => i !== ym1 && i !== ym2);
    const mu = st === 1 ? 1 : (2 * st - 1) / st, nu = st === 1 ? 0 : -(st - 1) / st;
    lap9(f[ym1], L);
    stage(f[ym1], f[ym2], L, f[out], mu, nu, mu * w1 * dts);
    prev = ym1; cur = out;
  }
}
const ms = performance.now() - t0;
console.log(JSON.stringify({ n, s, nsup, evals: nsup * s, dts, T: nsup * dts, ms: Math.round(ms), msPerEval: +(ms / (nsup * s)).toFixed(2) }));
if (outFile) fs.writeFileSync(outFile, Buffer.from(f[cur].buffer));
