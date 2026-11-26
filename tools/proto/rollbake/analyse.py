#!/usr/bin/env python3
"""Measures of the GPU roll bake against the CPU prototype.

Reads the fields that run.mjs wrote (float32, n x n, row 0 = texel y 0) and computes the same statistics as the CPU
prototype `sh.py` (its own functions, imported from SH_DIR: spectrum peak and width, share of ring power in the top 10
bins, mean angle off the wind, stripe ends and branches per 1000 wavelengths^2, tiling), plus two of this script: the
spread of the local roll spacing and of the local amplitude.

  python3 -B analyse.py SH_DIR stats RESULTS.json...          one line of measures per dumped field
  python3 -B analyse.py SH_DIR cpu RESULTS.json NAME          the CPU RKL1 run from the GPU job's own seed, compared
"""
import sys, os, json
import numpy as np
from scipy import ndimage

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
import sh  # noqa: E402  (the CPU prototype; not in this repository)

PPW = sh.PPW


def theta_of(job, n):
    """The wind's angle of the page's params shader, per texel."""
    th = sh.wind_angle(n)
    t2 = job.get('turn2', 0)
    if t2:
        x, y = sh.grid(n)
        tau = 2 * np.pi
        th = th + t2 * (np.sin(tau * (3 * x - 2 * y) + 2.0) + 0.7 * np.sin(tau * (2 * x + 5 * y) + 0.5))
    return th


def load(f, n):
    return np.fromfile(f, dtype=np.float32).reshape(n, n).astype(np.float64)


def spread(u):
    """Local wavenumber k = sqrt(<|grad u|^2> / <u^2>) over about one wavelength (sigma = PPW texels), in q0 units; the
    coefficient of variation of the spacing (1/k) and of the local amplitude, over the texels where the field is not
    near zero (local amplitude over half its median)."""
    gy, gx = np.gradient(u, sh.H)
    g2 = ndimage.gaussian_filter(gx * gx + gy * gy, PPW, mode='wrap')
    u2 = ndimage.gaussian_filter(u * u, PPW, mode='wrap')
    amp = np.sqrt(2 * u2)
    m = amp > 0.5 * np.median(amp)
    k = np.sqrt(g2[m] / u2[m])
    lam = 1 / k
    return dict(k_loc=float(np.mean(k)), spacing_cv=float(np.std(lam) / np.mean(lam)), amp_cv=float(np.std(amp) / np.mean(amp)))


def measures(u, theta):
    st, _ = sh.spectrum_stats(u)
    df, _ = sh.defects(u)
    err, coh = sh.local_orientation_error(u, theta)
    out = dict(kpeak=st['kpeak'], fwhm=st['fwhm_rel'], top10=st['top10'], ends=df['ends'], branches=df['branches'],
               orient_deg=err, tile=sh.tile_ratio(u), maxabs=float(np.abs(u).max()))
    out.update(spread(u))
    return out


def fmt(m):
    return (f"k={m['kpeak']:.3f} fwhm={m['fwhm']:.2f} top10={m['top10']:.3f} ends={m['ends']:.1f} br={m['branches']:.1f} "
            f"orient={m['orient_deg']:.2f}deg tile={m['tile']:.2f} kloc={m['k_loc']:.3f} spacingCV={m['spacing_cv']:.3f} "
            f"ampCV={m['amp_cv']:.3f} max|u|={m['maxabs']:.3f}")


def jobs(files):
    for f in files:
        for run in json.load(open(f)):
            for r in run['results']:
                if r.get('ev') == 'job' and r.get('fieldFile'):
                    yield f, r


def main():
    cmd = sys.argv[2]
    if cmd == 'stats':
        rows = []
        for f, r in jobs(sys.argv[3:]):
            u = load(r['fieldFile'], r['n'])
            m = measures(u, theta_of(r['job'], r['n']))
            m.update(name=r['name'], platform=os.path.basename(r['fieldFile']).split('-')[0], n=r['n'], fmt=r['fmt'])
            rows.append(m)
            print(f"{m['platform']:4} {r['name']:18} {fmt(m)}", flush=True)
        json.dump(rows, open(os.path.join(os.path.dirname(sys.argv[3]), 'stats.json'), 'w'), indent=1)
    elif cmd == 'sheets':
        sheets(sys.argv[3], sys.argv[4:])
    elif cmd == 'cpu':
        name = sys.argv[4]
        r = next(r for _, r in jobs([sys.argv[3]]) if r['name'] == name)
        n, job = r['n'], r['job']
        u0 = np.fromfile(r['seedFile'], dtype=np.float32).reshape(n, n)
        theta = theta_of(job, n)
        uc, k = sh.rkl1_real(u0, np.float32(job.get('eps', 0.25)), np.float32(0), np.float32(job.get('a', 0.5)), theta,
                             r['dts'], r['s'], r['nsup'], sh.lap9)
        uc = uc.astype(np.float64)
        ug = load(r['fieldFile'], n)
        np.save(os.path.join(os.path.dirname(sys.argv[3]), f'cpu-{name}.npy'), uc.astype(np.float32))
        print('cpu ', name, fmt(measures(uc, theta)))
        print('gpu ', name, fmt(measures(ug, theta)))
        print(f"corr(gpu, cpu)={np.corrcoef(ug.ravel(), uc.ravel())[0, 1]:.6f} max|gpu-cpu|={np.abs(ug - uc).max():.2e} "
              f"rms(gpu-cpu)/rms(cpu)={np.sqrt(np.mean((ug - uc) ** 2) / np.mean(uc ** 2)):.2e}")
        ref = np.load(os.path.join(sys.argv[1], 'out', 'A_A2.npy')).astype(np.float64)
        print('A2 spectral T=1500 (sh.py out/A_A2.npy)', fmt(measures(ref, sh.wind_angle(ref.shape[0]))))


A_PROFILE = 2 * np.sqrt(0.25 / 3)


def height(u):
    return np.power(0.5 + 0.5 * np.clip(u / A_PROFILE, -1, 1), 0.35)


def img(a, size, sym):
    return sh.to_img(a, size, sym=sym) if sym else sh.to_img(a, size, sym=False)


def panel(u, kind, size):
    """A picture of a field: the field itself (grey, symmetric about 0) or the height profile, whole or its 256^2 crop
    (upscaled without smoothing, so that texels show), a 2x2 tiling round the seams, or the spectrum."""
    from PIL import Image
    n = u.shape[0]
    if kind == 'spec':
        _, F = sh.spectrum_stats(u)
        return sh.spec_img(F, size)
    if kind == 'tile':
        t = np.tile(u, (2, 2))[n // 2:n // 2 + n, n // 2:n // 2 + n]
        return img(height(t), size, False)
    crop = kind.endswith('crop')
    a = u[:256, :256] if crop else u
    a = height(a) if kind.startswith('height') else a
    if kind.startswith('height'):
        im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    else:
        im = Image.fromarray((np.clip(0.5 + 0.5 * a / (np.abs(a).max() + 1e-12), 0, 1) * 255).astype(np.uint8))
    # Row 0 is texel y = 0: flip so that +y is up, as on the GPU.
    im = im.transpose(Image.FLIP_TOP_BOTTOM)
    return im.resize((size, size), Image.NEAREST if crop else Image.LANCZOS)


def sheets(outdir, files):
    stats = {}
    try:
        for m in json.load(open(os.path.join(os.path.dirname(files[0]), 'stats.json'))):
            stats[(m['platform'], m['name'])] = m
    except FileNotFoundError:
        pass
    fields = {}
    for f, r in jobs(files):
        plat = os.path.basename(r['fieldFile']).split('-')[0]
        fields[(plat, r['name'])] = (r, load(r['fieldFile'], r['n']))

    def lab(key, head):
        m = stats.get(key)
        if not m:
            return head
        return f"{head}\nspacingCV={m['spacing_cv']:.3f} ends={m['ends']:.1f} k={m['kpeak']:.2f} top10={m['top10']:.3f}"

    made = []
    # 1. The field at 1024^2 on GL, with the CPU prototype beside it.
    key = ('gl', 'n1024')
    if key in fields:
        r, u = fields[key]
        row1 = [(panel(u, 'field', 470), lab(key, 'GPU (GL) 1024^2, T=150, s=40: u, whole map')),
                (panel(u, 'fieldcrop', 470), 'u, 256^2 crop (32 x 32 wavelengths), texels shown'),
                (panel(u, 'spec', 470), 'power spectrum |k| < 2 q0 (log)')]
        row2 = [(panel(u, 'height', 470), 'height pow(0.5+0.5 clamp(u/A,-1,1), 0.35), A=2 sqrt(eps/3)'),
                (panel(u, 'heightcrop', 470), 'height, 256^2 crop'),
                (panel(u, 'tile', 470), 'height, 2x2 tiling: seams cross at the centre')]
        rows = [row1, row2]
        ref = os.path.join(sys.argv[1], 'out', 'A_A2.npy')
        cpu = os.path.join(os.path.dirname(files[0]), 'cpu-n512.npy')
        row3 = []
        if ('gl', 'n512') in fields:
            row3.append((panel(fields[('gl', 'n512')][1], 'heightcrop', 470), lab(('gl', 'n512'), 'GPU (GL) 512^2, height, 256^2 crop')))
        if os.path.exists(cpu):
            row3.append((panel(np.load(cpu).astype(np.float64), 'heightcrop', 470), 'CPU sh.py RKL1 from the same seed, 512^2'))
        if ('d3d', 'n1024') in fields:
            row3.append((panel(fields[('d3d', 'n1024')][1], 'heightcrop', 470), lab(('d3d', 'n1024'), 'GPU (Direct3D 11) 1024^2, height, crop')))
        elif os.path.exists(ref):
            row3.append((panel(np.load(ref).astype(np.float64), 'heightcrop', 470), 'CPU sh.py spectral A2, T=1500, 512^2'))
        if row3:
            rows.append(row3)
        p = os.path.join(outdir, 'sheet1_field_1024.png')
        sh.sheet(rows, p, 'Roll bake on the GPU (WebGL2, R32F, RKL1 s=40, 9-point Laplacian): eps=0.25, a=0.5, white-noise seed 0.01', pw=470)
        made.append(p)
    # 2. Formats.
    fm = [(k, v) for k, v in [('n1024', 'R32F'), ('n1024rgba16f', 'RGBA16F'), ('n1024r16f', 'R16F'), ('n1024s20', 'R32F, s=20')] if ('gl', k) in fields]
    if fm:
        rows = [[(panel(fields[('gl', k)][1], 'heightcrop', 440), lab(('gl', k), f'{v}: height, 256^2 crop')) for k, v in fm],
                [(panel(fields[('gl', k)][1], 'field', 440), f'{v}: u, whole 1024^2') for k, v in fm]]
        p = os.path.join(outdir, 'sheet2_formats.png')
        sh.sheet(rows, p, 'Float formats and stage count (GL, 1024^2, same seed)', pw=440)
        made.append(p)
    # 3. Variants against the fingerprint.
    vs = [('n1024', 'baseline T=150'), ('v_epsnoise', '(a) eps 0.25 +- 0.1 smooth noise'), ('v_turn', '(b) wind turning faster (turn2 0.4)'),
          ('v_T50', '(c) stopped at T=50'), ('v_T80', '(c) stopped at T=80'), ('v_kick05', '(d) noise kick 0.05 per super-step'),
          ('v_kick15', '(d) noise kick 0.15 per super-step'), ('v_kick40', '(d) noise kick 0.4 per super-step'),
          ('v_kick80', '(d) noise kick 0.8 per super-step'), ('v_combo', '(a)+(b)+T=80'),
          ('v_q10', '(e) wavenumber q 1 +- 0.1 smooth noise'), ('v_q20', '(e) wavenumber q 1 +- 0.2 smooth noise'),
          ('v_mix', '(a)+(b)+(e) q +- 0.15, T=150')]
    vs = [(k, v) for k, v in vs if ('gl', k) in fields]
    if vs:
        for part, sel in zip('abcd', [vs[i:i + 4] for i in range(0, len(vs), 4)]):
            if not sel:
                continue
            rows = [[(panel(fields[('gl', k)][1], 'heightcrop', 440), lab(('gl', k), v)) for k, v in sel],
                    [(panel(fields[('gl', k)][1], 'height', 440), 'whole 1024^2 map') for k, v in sel]]
            p = os.path.join(outdir, f'sheet3{part}_variants.png')
            sh.sheet(rows, p, 'Variants against a too regular fingerprint (GL, 1024^2, height profile; top: 256^2 crop, bottom: whole map)', pw=440)
            made.append(p)
    print('\n'.join(made))


if __name__ == '__main__':
    main()
