#!/usr/bin/env node
// The page's test tools: one command line, see tools/README.md.
//   node tools/sky.mjs <command> [options]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { which } from './lib/browser.mjs';

const TOOLS = import.meta.dirname;
const REPO = path.dirname(TOOLS);
const USAGE = `usage: node tools/sky.mjs <command> [options]
  trace       [--view NAME | --q QUERY] [--frames N] [--ms MS] [--size WxH] [--out FILE]
              the GL trace of the page's first frames, as text
  trace-diff  A B [--ignore ${'shader,line,comments,readback,query,start'}] [--max N]
              compares two traces; exit status 1 if they differ
  stills      [--views a,b] [--base DIR|REV] [--size WxH] [--out DIR]
              stills of the fixed views (tools/views.json); with --base, compared with the base's
  img-diff    A.png B.png [--out D.png] [--gain G] [--box x,y,w,h]
              differences of two pictures
  check       [NAME...] [--base DIR|REV] [--size WxH] [--out DIR] [--ignore CLASSES]
              runs the checks (all of: trace stills wrap loop res flight); one line each
  drive       SCRIPT.json      a scripted capture (steps, eval, shot, size, mouse; see README)
  perf        [--q QUERY] [--size WxH] [--seconds S]
              real time: time to the first draw, frame rate, GPU time per draw
common:       --page DIR (the page to test; default: this repository)
environment:  SKY_GPU=1 (the GPU; default SwiftShader), SKY_CHROME, SKY_CHROME_LIBS, SKY_WRAP, SKY_TIMEOUT`;

// Commands that start Chrome, and their time limits (s).
const LIMITS = { trace: 900, stills: 2400, check: 5400, drive: 900, perf: 300 };

function parseArgs(argv) {
  const opt = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a.slice(2), argv[++i]];
      if (v === undefined) throw new Error(`${a} needs a value`);
      opt[k] = v;
    } else opt._.push(a);
  }
  return opt;
}

// On a machine with a queue for heavy runs (SKY_WRAP=path, or ~/.claude/bin/heavy when it exists), the command
// runs again inside it, under timeout and, where systemd-run exists, a memory cap. SKY_WRAP=none turns this off.
// The queue and everything under it run in a process group of their own (timeout --foreground makes no group of
// its own), and a signal to this process goes to that whole group: Ctrl-C stops the run and frees the slot.
// Returns a promise of the exit status, or false when the command runs here.
function wrapped(cmd) {
  if (!LIMITS[cmd] || process.env.SKY_WRAPPED) return false;
  const mode = process.env.SKY_WRAP || 'auto';
  if (mode === 'none') return false;
  const heavy = mode === 'auto' ? path.join(os.homedir(), '.claude', 'bin', 'heavy') : mode;
  if (!fs.existsSync(heavy)) {
    if (mode !== 'auto') throw new Error(`SKY_WRAP=${mode}: no such file`);
    return false;
  }
  const secs = limit(cmd);
  const cap = which('systemd-run') ? ['systemd-run', '--user', '--scope', '-q', '-p', `MemoryMax=${process.env.SKY_MEMORY_MAX || '3G'}`,
    '-p', 'MemorySwapMax=0', '-p', 'TasksMax=500', '-p', `RuntimeMaxSec=${secs + 30}`] : [];
  console.error(`${cmd}: queued through ${heavy} (it waits for a free slot)`);
  const child = spawn(heavy, ['timeout', '--foreground', '-k', '10', String(secs + 20), ...cap, process.execPath, ...process.argv.slice(1)],
    { stdio: 'inherit', detached: true, env: { ...process.env, SKY_WRAPPED: '1' } });
  const pass = (sig) => { try { process.kill(-child.pid, sig); } catch {} };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => pass(sig));
  process.on('exit', () => { if (child.exitCode === null && child.signalCode === null) pass('SIGTERM'); });
  return new Promise((resolve) => child.on('exit', (code, sig) => resolve(code ?? (sig ? 128 : 1))));
}
const limit = (cmd) => +(process.env.SKY_TIMEOUT || LIMITS[cmd]);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(USAGE); return 0; }
  const opt = parseArgs(rest);
  if (!['trace', 'trace-diff', 'stills', 'img-diff', 'check', 'drive', 'perf'].includes(cmd)) throw new Error(`unknown command ${cmd}\n${USAGE}`);
  const queued = wrapped(cmd);
  if (queued) return await queued;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
  if (LIMITS[cmd]) {
    setTimeout(() => { console.error(`${cmd}: time limit of ${limit(cmd)} s reached`); process.exit(124); }, limit(cmd) * 1000).unref();
  }
  const page = path.resolve(opt.page || REPO);
  const gpu = !!process.env.SKY_GPU && process.env.SKY_GPU !== '0';
  // Without --out, each run writes to a folder of its own, so that two runs do not mix their files.
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + process.pid;
  const out = (name) => path.resolve(opt.out || path.join(TOOLS, 'out', name, stamp));

  if (cmd === 'trace-diff') {
    const { compareTraces, CLASSES } = await import('./lib/trace.mjs');
    const ignore = new Set((opt.ignore || '').split(',').filter(Boolean));
    for (const c of ignore) if (!CLASSES[c]) throw new Error(`--ignore: no class ${c} (${Object.keys(CLASSES).join(', ')})`);
    const [a, b] = opt._;
    const r = compareTraces(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'), { ignore, max: +(opt.max || 10) });
    if (r.headers) console.log(`headers differ:\n  A: ${r.headers[0]}\n  B: ${r.headers[1]}`);
    for (const l of r.report) console.log(l);
    console.log(r.summary);
    return r.same ? 0 : 1;
  }
  if (cmd === 'img-diff') {
    const { diffPng, fmtDiff } = await import('./lib/png.mjs');
    const d = diffPng(opt._[0], opt._[1], { out: opt.out, gain: +(opt.gain || 8), box: opt.box && opt.box.split(',').map(Number) });
    console.log(fmtDiff(d));
    return d.max === 0 ? 0 : 1;
  }

  const { Session } = await import('./lib/page.mjs');
  const run = await import('./lib/run.mjs');
  const session = await Session.start();
  try {
    console.log(`chrome: ${session.chrome.version} (${session.chrome.renderer}: ${await session.renderer()})`);
    const size = run.parseSize(opt.size || (gpu ? '1280x720' : '480x270'));
    if (cmd === 'trace') {
      const file = opt.out ? path.resolve(opt.out) : path.join(TOOLS, 'out', 'trace', `${stamp}-${opt.view || 'query'}.trace`);
      const r = await run.trace(session, page, { view: opt.view, q: opt.q, frames: opt.frames && +opt.frames, ms: opt.ms && +opt.ms,
        size: run.parseSize(opt.size || run.TRACE_SIZE), file });
      if (r.skip) { console.log(`${opt.view}: ${r.skip}: skipped`); return 0; }
      console.log(`${file}: ${r.lines} lines, ${(r.bytes / 1024).toFixed(0)} kB, ${r.seconds} s${r.warnings.length ? '\nwarnings:\n  ' + r.warnings.join('\n  ') : ''}${r.errors.length ? '\nERRORS:\n  ' + r.errors.join('\n  ') : ''}`);
      return r.errors.length ? 1 : 0;
    }
    if (cmd === 'stills') {
      const r = await run.stills(session, page, { views: opt.views, size, dir: out('stills'), base: opt.base && run.resolveBase(opt.base, REPO) });
      return r.ok ? 0 : 1;
    }
    if (cmd === 'drive') return await run.drive(session, page, JSON.parse(fs.readFileSync(opt._[0], 'utf8')), size);
    if (cmd === 'perf') return await run.perf(session, page, { q: opt.q || '', size, seconds: +(opt.seconds || 5) });
    if (cmd === 'check') {
      const { runChecks } = await import('./lib/checks.mjs');
      const ok = await runChecks(session, {
        names: opt._, page, base: opt.base && run.resolveBase(opt.base, REPO), size, gpu, dir: out('check'),
        ignore: opt.ignore || '',
      });
      return ok ? 0 : 1;
    }
  } finally {
    session.close();
  }
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err.stack || String(err)); process.exit(2); });
