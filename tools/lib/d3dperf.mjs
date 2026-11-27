// The frame time on Direct3D 11 against a base, measured in turns (`node tools/sky.mjs d3dperf`, see
// tools/README.md). Microsoft's shader compiler may fold or flatten a branch after a harmless-looking edit and
// make a frame a fifth slower with the same picture; GL does not show it. Each round runs the base and the page
// once each, one Windows Chrome for all the views of a page (the views follow one another in its tab), and the
// verdict compares the medians of the rounds.
import fs from 'node:fs';
import path from 'node:path';
import { d3dServer, servePage, pageUrl, runChrome, windowsChrome, CHROME_PATH } from './d3d.mjs';

// The views: flying (the page draws nothing at rest) at 50 km/h, the slowest speed that flies, so that a view
// moves some 20 m while it is measured. Dates and times are fixed, so that a view does not depend on the day.
export const VIEWS = [
  { name: 'default', q: 'date=172&time=15' },
  { name: 'overcast', q: 'date=172&time=15&cloud=1' },
  { name: 'heaps-3km', q: 'date=172&time=15&alt=3&cloud=0.5' },
  { name: 'tower', q: 'date=172&time=15&alt=3&at=36.3,58.9&yaw=90&pitch=4&cloud=0.5' },
  { name: 'cirrus', q: 'date=172&time=15&alt=12.5&pitch=0&cirrus=0.8' },
  { name: 'night', q: 'date=180&time=23&moon=14&yaw=-5&pitch=8&cloud=0.3' },
  // (The middle clouds, whose programs no other view has: from above, and from below, where they fill the picture.)
  { name: 'altocumulus', q: 'date=172&time=15&cloud=0.1&mid=0.7&midform=1' },
  { name: 'altocumulus-0.3km', q: 'date=172&time=15&alt=0.3&pitch=30&cloud=0&mid=0.7&midform=1' },
];
export const SPEED = 50;
// Frames timed in each view, after 10 left out.
export const FRAMES = 120;
// The ratio of the medians above which a view fails: the project's working limit for one pull request.
export const FAIL = 1.1;
// Rounds needed for a verdict (with fewer, every view is undecided), and the rounds run by default.
export const MIN_ROUNDS = 3;
export const ROUNDS = 5;

// A run's frame time: the mean GPU time of its frames. (Not their median: some views alternate between cheap and
// dear frames, nearly half of each, and the median of a run jumped from one kind to the other: 14.5 or 18.3 ms.)
export const frameTime = (times) => times.reduce((a, b) => a + b, 0) / times.length;

export const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// The run-to-run spread: the range of the runs as a share of their median; with five runs or more, the range
// without the lowest and the highest, which the median of the runs does not see either.
export const spread = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), k = s.length >= 5 ? 1 : 0;
  return (s[s.length - 1 - k] - s[k]) / median(a);
};

// The verdict of one view from the page's and the base's per-run medians (ms). The ratio of their medians is
// known to within the larger spread of the two: PASS when even its top stays at or under the limit, FAIL when
// even its bottom is over it, else undecided. Never a PASS on noise.
export function verdict(page, base, fail = FAIL, minRounds = MIN_ROUNDS) {
  if (!page.length) return { word: base.length ? 'FAIL' : 'undecided', note: base.length ? 'the page drew no frames' : 'no frames on either' };
  if (!base.length) return { word: 'undecided', note: 'the base drew no frames' };
  const ratio = median(page) / median(base), noise = Math.max(spread(page), spread(base));
  const r = { ratio, noise, lo: ratio * (1 - noise), hi: ratio * (1 + noise) };
  if (Math.min(page.length, base.length) < minRounds) return { ...r, word: 'undecided', note: `${Math.min(page.length, base.length)} runs, ${minRounds} needed` };
  if (r.hi <= fail) return { ...r, word: 'PASS' };
  if (r.lo > fail) return { ...r, word: 'FAIL' };
  return { ...r, word: 'undecided', note: `${r.lo.toFixed(2)} to ${r.hi.toFixed(2)}x with the spread, the limit ${fail.toFixed(2)}x within` };
}

// The line for a pull request's description.
export function summary(rows, { at = '', base = '' } = {}) {
  const count = (w) => rows.filter((r) => r.v.word === w).length;
  const rated = rows.filter((r) => Number.isFinite(r.v.ratio));
  const worst = rated.reduce((w, r) => (!w || r.v.ratio > w.v.ratio ? r : w), null);
  const noise = Math.max(0, ...rated.map((r) => r.v.noise));
  return `d3dperf: ${rows.length} views, worst ${worst ? `${worst.v.ratio.toFixed(2)}x (${worst.name})` : '-'}, ` +
    `${count('FAIL')} FAIL, ${count('undecided')} undecided, spread up to ${(noise * 100).toFixed(1)} %` +
    `${at ? ` at ${at}` : ''}${base ? ` vs ${base}` : ''}`;
}

// The programs' "compiled" lines and the first picture of the first view of a chain (its programs are compiled
// cold; the later views' may come from the GPU process's cache): name -> s since the navigation.
export function startOf(got) {
  const r = {};
  for (const g of got) {
    const m = g.ev === 'console' && /^Sky: program (.+) compiled, ([\d.]+) s$/.exec(g.msg);
    if (m) r[`${m[1]} ready`] = +m[2];
  }
  const shown = got.find((g) => g.ev === 'shown' && !g.failed);
  if (shown) r['first picture'] = shown.at;
  return r;
}

// The startup figures printed: the first picture and the three programs ready last on the base.
const BIG = 3;

const ms = (a) => `${median(a).toFixed(2)} ms (${Math.min(...a).toFixed(2)} to ${Math.max(...a).toFixed(2)})`;
const secs = (a) => `${median(a).toFixed(1)} s (${Math.min(...a).toFixed(1)} to ${Math.max(...a).toFixed(1)})`;

// One Chrome through the views of a page: each view reports to an id of its own and names the next.
async function chain(srv, page, key, views, { frames, size, limit, speed }) {
  servePage(srv, key, fs.readFileSync(path.join(page.dir, 'index.html'), 'utf8'));
  const ids = views.map((_, i) => `${key}v${i}`);
  const urls = views.map((v, i) => pageUrl(srv, key, ids[i], /(^|&)speed=/.test(v.q) ? v.q : `${v.q}&speed=${speed}`, frames));
  ids.forEach((id, i) => { srv.reports.set(id, []); if (i + 1 < ids.length) srv.next.set(id, urls[i + 1]); });
  const last = srv.reports.get(ids.at(-1));
  const t0 = Date.now();
  const timedOut = await runChrome(urls[0], () => last.some((g) => g.ev === 'done'), key, { limit, size });
  return { timedOut, seconds: (Date.now() - t0) / 1000, got: ids.map((id) => srv.reports.get(id)) };
}

// `node tools/sky.mjs d3dperf`: pages is [base, page], each { name, dir }. Returns the exit status: 0 when every
// view passes (or no Windows Chrome: skipped), 1 when one fails, 3 when none fails and one is undecided.
export async function d3dperf(pages, { views = VIEWS, rounds = ROUNDS, frames = FRAMES, size = { w: 1920, h: 1080 }, limit = 300,
  speed = SPEED, fail = FAIL, at = '', baseName = '', out = null }) {
  if (!windowsChrome()) {
    console.log(`SKIP d3dperf: no Windows Chrome at ${CHROME_PATH} (SKY_WIN_CHROME); it runs on WSL only`);
    return 0;
  }
  const t0 = Date.now();
  const sides = pages.map(() => ({ frames: views.map(() => []), raw: views.map(() => []), start: {}, size: null, renderer: null }));
  console.log(`d3dperf: ${views.length} views, ${rounds} rounds in turns (${pages.map((p) => p.name).join(', ')}), ` +
    `${frames} frames each at a window of ${size.w} x ${size.h}, ${speed} km/h, limit ${fail.toFixed(2)}x`);
  const srv = await d3dServer();
  try {
    for (let r = 0; r < rounds; r++) {
      for (const [p, page] of pages.entries()) {
        const c = await chain(srv, page, `r${r}p${p}`, views, { frames, size, limit, speed });
        const side = sides[p], line = [];
        c.got.forEach((got, i) => {
          const renderer = got.find((g) => g.ev === 'renderer')?.renderer;
          if (renderer && !side.renderer) side.renderer = renderer;
          if (renderer && !/Direct3D11/.test(renderer)) throw new Error(`d3dperf: the renderer is not Direct3D 11: ${renderer}`);
          for (const g of got) if (g.ev === 'console' && /lost|error|fail/i.test(g.msg)) console.log(`  ${page.name}, ${views[i].name}: ${g.msg}`);
          const f = got.find((g) => g.ev === 'frames');
          if (f?.times?.length) {
            side.frames[i].push(frameTime(f.times));
            side.raw[i].push(f.times);
            side.size ||= `${f.w} x ${f.h}`;
            line.push(`${views[i].name} ${frameTime(f.times).toFixed(2)}`);
          }
          else line.push(`${views[i].name} -`);
        });
        for (const [k, v] of Object.entries(startOf(c.got[0]))) (side.start[k] ||= []).push(v);
        console.log(`round ${r + 1}, ${page.name}: ${line.join(', ')} ms; ${c.seconds.toFixed(0)} s${c.timedOut ? `, stopped after ${limit} s` : ''}`);
      }
    }
  } finally {
    srv.close();
  }
  const [base, page] = sides;
  console.log(`renderer: ${page.renderer || base.renderer || '(none)'}; drawn at ${page.size || base.size || '?'}`);
  const rows = views.map((v, i) => ({ name: v.name, v: verdict(page.frames[i], base.frames[i], fail) }));
  const w = Math.max(...views.map((v) => v.name.length));
  rows.forEach((row, i) => {
    const b = base.frames[i], p = page.frames[i], v = row.v;
    console.log(`${v.word.padEnd(9)} ${row.name.padEnd(w)}  base ${b.length ? ms(b) : '-'}, page ${p.length ? ms(p) : '-'}` +
      (Number.isFinite(v.ratio) ? `, ${v.ratio.toFixed(3)}x, spread ${(spread(b) * 100).toFixed(1)} % | ${(spread(p) * 100).toFixed(1)} %` : '') +
      (v.note ? ` (${v.note})` : ''));
  });
  // The start, as information: the first view's programs and first picture, s since the navigation.
  const keys = Object.keys(base.start).filter((k) => k.endsWith(' ready') && page.start[k])
    .sort((a, b) => median(base.start[b]) - median(base.start[a])).slice(0, BIG);
  for (const k of ['first picture', ...keys]) {
    const b = base.start[k] || [], p = page.start[k] || [];
    if (!b.length && !p.length) continue;
    console.log(`start     ${k}: base ${b.length ? secs(b) : '-'}, page ${p.length ? secs(p) : '-'}` +
      (b.length && p.length ? `, ${(median(p) / median(b)).toFixed(2)}x` : ''));
  }
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ views, size, speed, frames, pages: pages.map((p, k) => ({ name: p.name, at: k ? at : baseName,
      renderer: sides[k].renderer, drawn: sides[k].size, start: sides[k].start, times: Object.fromEntries(views.map((v, i) => [v.name, sides[k].raw[i]])) })) }));
    console.log(`frames: ${out}`);
  }
  console.log(`time: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  console.log(summary(rows, { at, base: baseName }));
  return rows.some((r) => r.v.word === 'FAIL') ? 1 : rows.some((r) => r.v.word === 'undecided') ? 3 : 0;
}
