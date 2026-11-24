#!/usr/bin/env node
// The page's test tools: one command line, see tools/README.md.
//   node tools/sky.mjs <command> [options]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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
  look        [--only a,b] [--size WxH] [--out DIR] [--from DIR] [--sheet [--base DIR|REV]]
              the views of the reported flaws (tools/look.json), measured against absolute limits
  check       [NAME...] [--base DIR|REV] [--size WxH] [--out DIR] [--ignore CLASSES]
              runs look, then the checks (all of: trace stills wrap loop res flight steer); one line each
  drive       SCRIPT.json      a scripted capture (steps, eval, shot, size, mouse; see README)
  perf        [--q QUERY] [--size WxH] [--dpr R] [--mobile] [--cpu N] [--no-gpu] [--seconds S]
              real time: time to the first draw, frame rate, GPU time per draw
  d3d         [page|programs] [--base DIR|REV] [--runs N] [--q QUERY] [--size WxH] [--frames N] [--limit S] [--shot S --out PREFIX]
              on WSL: the start on Windows Chrome's Direct3D 11 (each program's compile, or the page's ?timing)
  d3dperf     [--base DIR|REV] [--rounds N] [--views a,b] [--frames N] [--size WxH] [--speed KMH] [--fail RATIO] [--limit S]
              on WSL: the frame time on Direct3D 11 against the base (default origin/main), in turns; one line to paste
common:       --page DIR (the page to test; default: this repository)
environment:  SKY_GPU=1 (the GPU; default SwiftShader), SKY_CHROME, SKY_CHROME_LIBS, SKY_WRAP, SKY_TIMEOUT, SKY_WIN_CHROME`;

// Commands that start Chrome, and their time limits (s).
const LIMITS = { trace: 900, stills: 2400, look: 1200, check: 5400, drive: 900, perf: 300 };

// The options that take no value: `--mobile --dpr 2.6` took '--dpr' as the value of --mobile, and the DPR stayed 1.
const FLAGS = new Set(['mobile', 'no-gpu', 'sheet']);
function parseArgs(argv) {
  const opt = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.includes('=') ? [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
        : FLAGS.has(a.slice(2)) ? [a.slice(2), ''] : [a.slice(2), argv[++i]];
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
// The commit a page is at, for look's summary: a revision's short SHA; this repository's HEAD, with
// '+changes' when index.html differs from it; nothing for another directory.
function commitOf(spec) {
  const git = (...a) => spawnSync('git', ['-C', REPO, ...a], { encoding: 'utf8' });
  if (spec !== REPO) { const r = git('rev-parse', '--short', '--verify', '--quiet', spec + '^{commit}'); return r.status === 0 ? r.stdout.trim() : ''; }
  const head = git('rev-parse', '--short', 'HEAD').stdout.trim();
  return head + (git('status', '--porcelain', '--', 'index.html').stdout.trim() ? '+changes' : '');
}
const lookOptions = (opt) => ({ only: opt.only });
const limit = (cmd) => +(process.env.SKY_TIMEOUT || LIMITS[cmd]);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') { console.log(USAGE); return 0; }
  const opt = parseArgs(rest);
  if (!['trace', 'trace-diff', 'stills', 'img-diff', 'look', 'check', 'drive', 'perf', 'd3d', 'd3dperf'].includes(cmd)) throw new Error(`unknown command ${cmd}\n${USAGE}`);
  // look --from DIR measures stills already made: no Chrome, no queue.
  if (cmd === 'look' && opt.from && !('sheet' in opt)) {
    const { look } = await import('./lib/look.mjs');
    return (await look(null, { ...lookOptions(opt), from: path.resolve(opt.from) })) ? 0 : 1;
  }
  const queued = wrapped(cmd);
  if (queued) return await queued;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
  if (LIMITS[cmd]) {
    setTimeout(() => { console.error(`${cmd}: time limit of ${limit(cmd)} s reached`); process.exit(124); }, limit(cmd) * 1000).unref();
  }
  // --page: a directory, or (for look) a git revision exported like a base.
  const rev = cmd === 'look' && opt.page && !fs.existsSync(opt.page);
  const page = rev ? (await import('./lib/run.mjs')).resolveBase(opt.page, REPO) : path.resolve(opt.page || REPO);
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

  if (cmd === 'd3d') {
    // Windows Chrome, not this machine's: not queued, each run under its own limit.
    const { d3d } = await import('./lib/d3d.mjs');
    const { parseSize, resolveBase } = await import('./lib/run.mjs');
    const pages = [{ name: 'page', dir: page }];
    if (opt.base) pages.unshift({ name: `base ${opt.base}`, dir: resolveBase(opt.base, REPO) });
    const mode = opt._[0] || 'page';
    if (!['page', 'programs'].includes(mode)) throw new Error(`d3d: no mode ${mode} (page, programs)`);
    if (opt.shot && (mode !== 'page' || !opt.out)) throw new Error('d3d: --shot needs the mode page and --out PREFIX');
    await d3d(pages, { mode, q: opt.q || '', runs: +(opt.runs || 1), limit: +(opt.limit || 300), frames: +(opt.frames || 60),
      size: parseSize(opt.size || '1920x1080'), shot: +(opt.shot || 0), out: opt.out || null });
    return 0;
  }
  if (cmd === 'd3dperf') {
    // Windows Chrome too, not queued.
    const { d3dperf, VIEWS, ROUNDS, SPEED, FAIL, FRAMES } = await import('./lib/d3dperf.mjs');
    const { windowsChrome } = await import('./lib/d3d.mjs');
    const { parseSize, resolveBase } = await import('./lib/run.mjs');
    const baseSpec = opt.base || 'origin/main';
    const names = opt.views ? opt.views.split(',') : VIEWS.map((v) => v.name);
    for (const n of names) if (!VIEWS.some((v) => v.name === n)) throw new Error(`d3dperf: no view ${n} (${VIEWS.map((v) => v.name).join(', ')})`);
    // (Without Windows Chrome, no base is exported: d3dperf only says it skips.)
    const pages = windowsChrome() ? [{ name: 'base', dir: resolveBase(baseSpec, REPO) }, { name: 'page', dir: page }] : [];
    const baseAt = commitOf(baseSpec);
    return await d3dperf(pages, { views: VIEWS.filter((v) => names.includes(v.name)), rounds: +(opt.rounds || ROUNDS),
      frames: +(opt.frames || FRAMES), size: parseSize(opt.size || '1920x1080'), limit: +(opt.limit || 300), speed: +(opt.speed ?? SPEED),
      fail: +(opt.fail || FAIL), out: path.join(out('d3dperf'), 'frames.json'), at: commitOf(page), baseName: baseAt && baseAt !== baseSpec ? `${baseSpec} (${baseAt})` : baseSpec });
  }
  const { Session } = await import('./lib/page.mjs');
  const run = await import('./lib/run.mjs');
  const session = await Session.start();
  let lookOk = true;
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
    if (cmd === 'drive') {
      // One script, or a list of them run one after another in the same Chrome (one wait in the queue).
      let status = 0;
      for (const script of [].concat(JSON.parse(fs.readFileSync(opt._[0], 'utf8')))) {
        if (script.name) console.log(`== ${script.name}`);
        status = Math.max(status, await run.drive(session, script.page ? path.resolve(script.page) : page, script, size));
      }
      return status;
    }
    if (cmd === 'perf') return await run.perf(session, page, { q: opt.q || '', size, seconds: +(opt.seconds || 5), dpr: +(opt.dpr || 1), mobile: 'mobile' in opt, cpu: +(opt.cpu || 1), noGpu: 'no-gpu' in opt });
    const base = opt.base && run.resolveBase(opt.base, REPO);
    // check runs look first (unless names are given without look): the flaws reported stay fixed. Its limits
    // were set on the GPU, and its stills take minutes each on SwiftShader: there check skips it.
    const wantLook = cmd === 'check' && (!opt._.length || opt._.includes('look'));
    const onlyLook = opt._.length > 0 && opt._.every((n) => n === 'look');
    if (wantLook && !gpu) console.log('SKIP look: it needs the GPU (SKY_GPU=1)');
    if (cmd === 'look' || (wantLook && gpu)) {
      const { look } = await import('./lib/look.mjs');
      const ok = await look(session, { ...lookOptions(opt), page, size: opt.size && size, dir: cmd === 'look' ? out('look') : path.join(out('check'), 'look'),
        base, baseName: opt.base, sheet: cmd === 'look' && 'sheet' in opt, from: opt.from && path.resolve(opt.from), at: commitOf(rev ? opt.page : page) });
      if (cmd === 'look') return ok ? 0 : 1;
      console.log(`${ok ? 'PASS' : 'FAIL'} look (above)`);
      lookOk = ok;
    }
    if (onlyLook) return lookOk ? 0 : 1;
    opt._ = opt._.filter((n) => n !== 'look');
    if (cmd === 'check') {
      const { runChecks } = await import('./lib/checks.mjs');
      const ok = await runChecks(session, {
        names: opt._, page, base, size, gpu, dir: out('check'),
        ignore: opt.ignore || '',
      });
      return ok && lookOk ? 0 : 1;
    }
  } finally {
    session.close();
  }
  return 0;
}

main().then((code) => process.exit(code), (err) => { console.error(err.stack || String(err)); process.exit(2); });
