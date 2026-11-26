// Runs the roll bake prototype (index.html here) with a list of jobs, in headless Chrome on this machine's GL
// (the tools' own Chrome and flags) or in Windows Chrome on ANGLE Direct3D 11 (the path of `sky.mjs d3d`), and
// writes what the page posts: OUT/results.json, and each dumped field as OUT/<platform>-<job>.f32 (float32, n * n,
// row 0 at texel y = 0).
//
//   HEAVY_SLOTS=2 ~/.claude/bin/heavy node tools/proto/rollbake/run.mjs gl jobs.json OUT
//   flock /tmp/claude-1000/d3d.lock ~/.claude/bin/heavy node tools/proto/rollbake/run.mjs d3d jobs.json OUT
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep } from '../../lib/browser.mjs';
import { d3dServer, runChrome, windowsChrome } from '../../lib/d3d.mjs';

const [mode, jobsFile, out, limitArg] = process.argv.slice(2);
if (!['gl', 'd3d'].includes(mode) || !jobsFile || !out) {
  console.error('usage: run.mjs gl|d3d JOBS.json OUT_DIR [LIMIT_S]');
  process.exit(2);
}
const limit = +(limitArg || 600);
const here = path.dirname(fileURLToPath(import.meta.url));
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8').replace('const JOBS = null;', `const JOBS = ${JSON.stringify(jobs)};`);
fs.mkdirSync(out, { recursive: true });

const srv = await d3dServer();
const id = `${mode}${process.pid}`;
srv.files.set(`/d3d/page/${id}/index.html`, html);
srv.reports.set(id, []);
const got = srv.reports.get(id);
const finished = () => got.some((g) => g.ev === 'done');
let timedOut = false;
try {
  if (mode === 'gl') {
    const chrome = await launchChrome();
    try {
      const { targetId } = await chrome.send('Target.createTarget', { url: `http://127.0.0.1:${srv.port}/d3d/page/${id}/index.html?d3d=${id}` });
      const t0 = Date.now();
      while (!finished() && !chrome.dead() && Date.now() - t0 < limit * 1000) await sleep(250);
      timedOut = !finished();
      await chrome.send('Target.closeTarget', { targetId }).catch(() => {});
    } finally {
      chrome.close();
    }
  } else {
    if (!windowsChrome()) throw new Error('no Windows Chrome');
    timedOut = await runChrome(`http://localhost:${srv.port}/d3d/page/${id}/index.html?d3d=${id}`, finished, id, { limit, size: { w: 800, h: 700 } });
  }
} finally {
  srv.close();
}

const results = [];
for (const g of got) {
  const { field, seed, ...rest } = g;
  if (field) {
    const f = path.join(out, `${mode}-${g.name}.f32`);
    fs.writeFileSync(f, Buffer.from(field, 'base64'));
    rest.fieldFile = f;
  }
  if (seed) {
    const f = path.join(out, `${mode}-${g.name}-seed.f32`);
    fs.writeFileSync(f, Buffer.from(seed, 'base64'));
    rest.seedFile = f;
  }
  results.push(rest);
  const show = { ...rest };
  delete show.job;
  console.log(JSON.stringify(show));
}
const file = path.join(out, `results-${mode}.json`);
let all = [];
try { all = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
fs.writeFileSync(file, JSON.stringify([...all, { at: new Date().toISOString(), timedOut, results }], null, 1));
console.log(timedOut ? `stopped after ${limit} s` : 'done', '->', file);
