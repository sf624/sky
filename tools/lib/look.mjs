// The command look: the views of tools/look.json (the flaws the owner reported), one still each, measured
// against absolute limits (lib/measures.mjs). One line per entry: PASS, FAIL or KNOWN (a known open flaw).
import fs from 'node:fs';
import path from 'node:path';
import { readPng, writePng } from './png.mjs';
import { MEASURES } from './measures.mjs';
import { stillQuery, runView, parseSize } from './run.mjs';
import { sheet } from './sheet.mjs';

export const REGISTRY_FILE = path.join(import.meta.dirname, '..', 'look.json');
export const loadRegistry = (file = REGISTRY_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));

// The entries to run: all, or those named (--only a,b).
export function pick(reg, { only } = {}) {
  let list = reg.entries;
  if (only) {
    const names = only.split(',');
    for (const n of names) if (!list.some((e) => e.name === n)) throw new Error(`look: no entry ${n} (${list.map((e) => e.name).join(', ')})`);
    list = list.filter((e) => names.includes(e.name));
  }
  return list;
}

// The stills of an entry: one, or with a sweep ({ param, values }) one for each value of a parameter of the page
// (NAME@VALUE.png), whose measures take the list of pictures in order.
export const stillsOf = (e) => e.sweep
  ? e.sweep.values.map((v) => ({ file: `${e.name}@${v}.png`, q: `${e.q}&${e.sweep.param}=${v}` }))
  : [{ file: `${e.name}.png`, q: e.q }];
const readStills = (e, dir) => {
  const imgs = stillsOf(e).map((s) => readPng(path.join(dir, s.file)));
  return e.sweep ? imgs : imgs[0];
};

// Measures one still (or a sweep's list of stills) against an entry's limits. Returns { status: PASS | FAIL | KNOWN | UNEXPECTED, values }, where
// UNEXPECTED is an entry marked expected: 'fail' that passed. Each value: { measure, value, min, max, ok, text }.
export function judge(entry, img) {
  const values = entry.measures.map((m) => {
    const f = MEASURES[m.measure];
    if (!f) throw new Error(`look: ${entry.name}: no measure ${m.measure} (${Object.keys(MEASURES).join(', ')})`);
    const value = f(img, m);
    const name = m.label || m.measure + (m.measure === 'lumaPct' ? ` p${m.p ?? 50}` : m.measure === 'brightColour' ? ` ${m.of || 'sat'}` : '');
    const ok = (m.min === undefined || value >= m.min) && (m.max === undefined || value <= m.max);
    const lim = [m.min !== undefined ? `>= ${m.min}` : '', m.max !== undefined ? `<= ${m.max}` : ''].filter(Boolean).join(', ');
    return { measure: name, value, min: m.min, max: m.max, ok, text: `${name} ${fmt(value)}${lim ? ` (${lim})` : ''}${ok ? '' : ' !'}` };
  });
  const ok = values.every((v) => v.ok);
  const known = entry.expected === 'fail';
  return { status: known ? (ok ? 'UNEXPECTED' : 'KNOWN') : ok ? 'PASS' : 'FAIL', values };
}
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));

// Renders the stills of the entries into dir (NAME.png; one render per distinct query). Returns errors by name.
export async function render(session, root, list, size, dir, reg = loadRegistry()) {
  fs.mkdirSync(dir, { recursive: true });
  const done = new Map(), errors = {};
  for (const e of list) {
    for (const st of stillsOf(e)) {
      const png = path.join(dir, st.file);
      const q = stillQuery(st.q);
      if (done.has(q)) { fs.copyFileSync(done.get(q), png); continue; }
      const t0 = Date.now();
      const r = await runView(session, root, { name: e.name, q, frames: reg.frames, ms: reg.ms }, size, { png });
      if (r.errors.length) errors[e.name] = (errors[e.name] || []).concat(r.errors);
      done.set(q, png);
      console.error(`  ${st.file.replace(/\.png$/, '')}: rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
  }
  return errors;
}

// Prints one line per entry and the summary line (for the pull request); returns true when no entry failed and
// none marked 'fail' passed.
export function report(list, dir, errors = {}, at = '') {
  const count = { PASS: 0, KNOWN: 0, FAIL: 0, 'PASS?': 0 };
  for (const e of list) {
    const r = judge(e, readStills(e, dir));
    const err = errors[e.name] || [];
    let word = r.status === 'UNEXPECTED' ? 'PASS?' : r.status;
    if (err.length && word !== 'KNOWN') word = 'FAIL';
    count[word]++;
    console.log(`${word.padEnd(5)} ${e.name}: ${r.values.map((v) => v.text).join('; ') || 'no measure (a recorded view)'}`
      + (word === 'PASS?' ? '\n      marked expected: "fail" but passes: remove the mark if the flaw is fixed' : '')
      + (err.length ? '\n      ERRORS: ' + err.join('\n      ') : ''));
  }
  console.log(`look: ${count.PASS} PASS, ${count.KNOWN} KNOWN, ${count.FAIL} FAIL${count['PASS?'] ? `, ${count['PASS?']} PASS? (marked fail)` : ''}${at ? ` at ${at}` : ''}`);
  return count.FAIL + count['PASS?'] === 0;
}

// The command. opt: { page, at (the commit, for the summary), base, baseName, only, size, dir, from, sheet }.
export async function look(session, opt) {
  const reg = loadRegistry();
  const list = pick(reg, opt);
  if (!list.length) throw new Error('look: no entries');
  const t0 = Date.now();
  let errors = {};
  // The registry's size unless --size: the limits are in pixels of that size (specks, runs).
  opt.size = opt.size || parseSize(reg.size);
  if (!opt.from) {
    console.log(`look: ${list.length} entries, page ${opt.page}, ${opt.size.w}x${opt.size.h}`);
    errors = await render(session, opt.page, list, opt.size, opt.dir, reg);
  }
  const dir = opt.from || opt.dir;
  const ok = report(list, dir, errors, opt.at);
  console.log(`stills: ${dir}`);
  if (opt.sheet) {
    let baseDir = null;
    if (opt.base) {
      baseDir = path.join(opt.dir, 'base');
      await render(session, opt.base, list, opt.size, baseDir, reg);
    }
    const file = path.join(dir, 'sheet.png');
    // One row per still: entries that share a query share a row.
    const rows = new Map();
    for (const e of list) {
      const q = stillQuery(e.q) + (e.sweep ? ' sweep' : '');
      if (rows.has(q)) { rows.get(q).names.push(e.name); continue; }
      const of = (d) => stillsOf(e).map((st) => readPng(path.join(d, st.file)));
      rows.set(q, { names: [e.name], images: [...(baseDir ? of(baseDir) : []), ...of(dir)] });
    }
    const cols = baseDir ? `   (base ${opt.baseName || ''} | page ${opt.at || ''})` : '';
    writePng(file, sheet([...rows.values()].map((r) => ({ label: r.names.join(', ') + cols, images: r.images }))));
    console.log(`sheet: ${file}${baseDir ? ' (each row: base | page)' : ''}`);
  }
  console.log(`time: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return ok;
}
