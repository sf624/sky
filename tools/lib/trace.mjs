// The GL trace as a text file, and the comparison of two traces.
//
// Layout: '#' lines are a header (the query, the size, the renderer); they are not compared. Then, for each canvas
// in the order its context was made, "canvas NAME", and for each frame "frame K" followed by one line per call:
// "method(args) = result". Shader texts are named by hash (src:HASH) and given once each at the end, after
// "source HASH", one "| " line per line of text.
import { hashBytes } from './inpage.mjs';

export function formatTrace(dump, header) {
  const out = ['sky-trace 1', ...header.map((h) => '# ' + h)];
  for (const c of dump.canvases) {
    out.push(`canvas ${c.name}`);
    let f = -1;
    for (const [frame, text] of c.lines) {
      while (f < frame) out.push(`frame ${++f}`);
      out.push(text);
    }
    while (f < dump.frames) out.push(`frame ${++f}`);
  }
  for (const h of Object.keys(dump.sources).sort()) {
    const lines = dump.sources[h].split('\n');
    out.push(`source ${h} ${lines.length} lines`, ...lines.map((l) => '| ' + l));
  }
  return out.join('\n') + '\n';
}

export function parseTrace(text) {
  const t = { header: [], canvases: new Map(), sources: new Map() };
  let frames = null, lines = null, src = null;
  for (const line of text.split('\n')) {
    if (src) {
      if (line.startsWith('| ') || line === '|') { src.push(line.slice(2)); continue; }
      src = null;
    }
    if (line === '' || line === 'sky-trace 1') continue;
    if (line.startsWith('# ')) t.header.push(line.slice(2));
    else if (line.startsWith('canvas ') && !line.startsWith('canvas.')) t.canvases.set(line.slice(7), frames = new Map());
    else if (/^frame \d+$/.test(line)) frames.set(+line.slice(6), lines = []);
    else if (line.startsWith('source ')) t.sources.set(line.split(' ')[1], src = []);
    else lines.push(line);
  }
  for (const [h, l] of t.sources) t.sources.set(h, l.join('\n'));
  return t;
}

// The classes of difference that compareTraces can ignore.
export const CLASSES = {
  shader: 'the text of shaders (calls that pass one still count)',
  line: '#line directives in shader texts',
  comments: 'comments, blank lines and spacing in shader texts',
  readback: 'hashes of what the frames drew (textures and canvases)',
  query: 'calls that only ask (get*, is*, checkFramebufferStatus)',
};
const QUERY = /^(get[A-Z]\w*|is[A-Z]\w*|checkFramebufferStatus)\(/;

function normalise(t, ignore) {
  const text = (h) => {
    let s = t.sources.get(h) ?? '';
    if (ignore.has('line')) s = s.split('\n').filter((l) => !/^\s*#\s*line\b/.test(l)).join('\n');
    if (ignore.has('comments')) {
      s = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '')
        .split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
    }
    return s;
  };
  const ids = new Map();
  const srcId = (h) => {
    if (ignore.has('shader')) return '*';
    if (!ids.has(h)) ids.set(h, ignore.has('line') || ignore.has('comments') ? hashBytes(new TextEncoder().encode(text(h))) : h);
    return ids.get(h);
  };
  const canvases = new Map();
  for (const [name, frames] of t.canvases) {
    const out = new Map();
    for (const [f, lines] of frames) {
      out.set(f, lines.filter((l) => !(ignore.has('readback') && l.startsWith('readback ')) && !(ignore.has('query') && QUERY.test(l)))
        .map((l) => l.replace(/src:([0-9a-f]{16})/g, (_, h) => 'src:' + srcId(h))));
    }
    canvases.set(name, out);
  }
  const texts = new Map();
  for (const h of t.sources.keys()) texts.set(srcId(h), text(h));
  return { canvases, texts };
}

// The longest common subsequence of a and b, as a list of hunks { a0, a1, b0, b1 } (half-open ranges that differ).
function hunks(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const A = a.slice(p, a.length - s), B = b.slice(p, b.length - s);
  const n = A.length, m = B.length;
  if (!n && !m) return [];
  if (n * m > 4e7) return [{ a0: p, a1: p + n, b0: p, b1: p + m }];
  const L = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * (m + 1) + j] = A[i] === B[j] ? L[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(L[(i + 1) * (m + 1) + j], L[i * (m + 1) + j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0, cur = null;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { cur = null; i++; j++; continue; }
    if (!cur) out.push(cur = { a0: p + i, a1: p + i, b0: p + j, b1: p + j });
    if (j >= m || (i < n && L[(i + 1) * (m + 1) + j] >= L[i * (m + 1) + j + 1])) { i++; cur.a1++; } else { j++; cur.b1++; }
  }
  return out;
}

// Where two shader texts first differ, as a few lines of text.
function textDiff(x, y) {
  const a = x.split('\n'), b = y.split('\n');
  const [h] = hunks(a, b);
  if (!h) return [];
  const out = [`    shader text differs at line ${h.a0 + 1}:`];
  for (const l of a.slice(h.a0, Math.min(h.a1, h.a0 + 4))) out.push('    - ' + l);
  for (const l of b.slice(h.b0, Math.min(h.b1, h.b0 + 4))) out.push('    + ' + l);
  return out;
}

// Compares two trace texts. Returns { same, summary, report (lines), headers }. max: how many differences to print.
export function compareTraces(textA, textB, { ignore = new Set(), max = 10 } = {}) {
  const ta = parseTrace(textA), tb = parseTrace(textB);
  const a = normalise(ta, ignore), b = normalise(tb, ignore);
  const report = [];
  let count = 0;
  const where = [];
  const names = [...new Set([...a.canvases.keys(), ...b.canvases.keys()])];
  for (const name of names) {
    const fa = a.canvases.get(name), fb = b.canvases.get(name);
    if (!fa || !fb) {
      count++;
      where.push(`canvas ${name} only in ${fa ? 'A' : 'B'}`);
      report.push(`canvas ${name}: only in ${fa ? 'A' : 'B'}`);
      continue;
    }
    const frames = [...new Set([...fa.keys(), ...fb.keys()])].sort((x, y) => x - y);
    const diffFrames = [];
    for (const f of frames) {
      const la = fa.get(f) || [], lb = fb.get(f) || [];
      const hs = hunks(la, lb);
      if (!hs.length) continue;
      diffFrames.push(f);
      for (const h of hs) {
        count++;
        if (count > max) continue;
        report.push(`canvas ${name}, frame ${f}, call ${h.a0 + 1} of ${la.length} in A, ${h.b0 + 1} of ${lb.length} in B:`);
        for (const l of la.slice(Math.max(0, h.a0 - 2), h.a0)) report.push('    ' + l);
        const del = la.slice(h.a0, h.a1), add = lb.slice(h.b0, h.b1);
        for (const l of del.slice(0, 6)) report.push('  - ' + l);
        if (del.length > 6) report.push(`  - ... ${del.length - 6} more`);
        for (const l of add.slice(0, 6)) report.push('  + ' + l);
        if (add.length > 6) report.push(`  + ... ${add.length - 6} more`);
        const sa = del.map((l) => /src:(\w+)/.exec(l)).find(Boolean), sb = add.map((l) => /src:(\w+)/.exec(l)).find(Boolean);
        if (sa && sb && sa[1] !== '*') report.push(...textDiff(a.texts.get(sa[1]) ?? '', b.texts.get(sb[1]) ?? ''));
      }
    }
    if (diffFrames.length) where.push(`canvas ${name}: frame${diffFrames.length > 1 ? 's' : ''} ${diffFrames.join(', ')}`);
  }
  if (count > max) report.push(`... and ${count - max} more difference${count - max > 1 ? 's' : ''}`);
  const ha = ta.header.join(' | '), hb = tb.header.join(' | ');
  const head = count ? `${count} difference${count > 1 ? 's' : ''} (${where.join('; ')})` : 'identical';
  return { same: count === 0, summary: head, report, headers: ha === hb ? null : [ha, hb] };
}
