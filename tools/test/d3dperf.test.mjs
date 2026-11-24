// Unit tests of d3dperf's arithmetic: node --test tools/test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { median, spread, verdict, summary, startOf, frameTime, VIEWS } from '../lib/d3dperf.mjs';

test('median: odd and even counts, unsorted input left as it was', () => {
  const a = [3, 1, 2];
  assert.equal(median(a), 2);
  assert.deepEqual(a, [3, 1, 2]);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Number.isNaN(median([])));
});

test('spread: the range as a share of the median', () => {
  assert.equal(spread([10, 10, 10]), 0);
  assert.ok(Math.abs(spread([9, 10, 11]) - 0.2) < 1e-12);
});

test('verdict: the same numbers pass', () => {
  const v = verdict([16, 16.1, 15.9], [16, 16.05, 15.95]);
  assert.equal(v.word, 'PASS');
  assert.ok(Math.abs(v.ratio - 1) < 1e-12);
});

test('verdict: a fifth slower with a small spread fails', () => {
  const v = verdict([19.2, 19.3, 19.1], [16, 16.1, 15.9]);
  assert.equal(v.word, 'FAIL');
  assert.ok(Math.abs(v.ratio - 19.2 / 16) < 1e-12);
});

test('verdict: under the limit but within the spread of it is undecided, never PASS', () => {
  // 1.05x, with a spread of 10 %: the ratio might be 1.155x.
  const v = verdict([16.8, 16, 17.6], [16, 16, 16]);
  assert.equal(v.word, 'undecided');
  assert.match(v.note, /limit 1\.10x within/);
});

test('verdict: over the limit but within the spread of it is undecided, not FAIL', () => {
  const v = verdict([18, 16.5, 19.5], [16, 16, 16]);
  assert.equal(v.word, 'undecided');
});

test('verdict: the limit can be set', () => {
  assert.equal(verdict([17, 17, 17], [16, 16, 16], 1.05).word, 'FAIL');
  assert.equal(verdict([17, 17, 17], [16, 16, 16], 1.1).word, 'PASS');
});

test('verdict: fewer rounds than needed are undecided; missing frames', () => {
  assert.equal(verdict([16, 16], [16, 16]).word, 'undecided');
  assert.equal(verdict([], [16, 16, 16]).word, 'FAIL');
  assert.equal(verdict([16, 16, 16], []).word, 'undecided');
  assert.equal(verdict([], []).word, 'undecided');
});

test('summary: the worst view, the counts, the largest spread', () => {
  const rows = [
    { name: 'default', v: verdict([16, 16.1, 15.9], [16, 16, 16]) },
    { name: 'tower', v: verdict([19.2, 19.3, 19.1], [16, 16.1, 15.9]) },
    { name: 'night', v: verdict([], []) },
  ];
  assert.equal(summary(rows, { at: 'abc1234', base: 'origin/main (def5678)' }),
    'd3dperf: 3 views, worst 1.20x (tower), 1 FAIL, 1 undecided, spread up to 1.3 % at abc1234 vs origin/main (def5678)');
});

test('startOf: the programs ready and the first picture', () => {
  const got = [
    { ev: 'console', msg: 'Sky: program fs (CLOUD_PASS) compiled, 9.73 s' },
    { ev: 'console', msg: 'Sky: still compiling fs, 9.73 s' },
    { ev: 'console', msg: 'Sky: program fs compiled, 11.63 s' },
    { ev: 'shown', at: 13.98, failed: false },
  ];
  assert.deepEqual(startOf(got), { 'fs (CLOUD_PASS) ready': 9.73, 'fs ready': 11.63, 'first picture': 13.98 });
});

test('VIEWS: unique names, each a fixed date and time', () => {
  assert.equal(new Set(VIEWS.map((v) => v.name)).size, VIEWS.length);
  for (const v of VIEWS) assert.match(v.q, /(^|&)date=\d+&time=[\d.]+/, v.name);
});

test('spread: from five runs on, without the lowest and the highest', () => {
  assert.ok(Math.abs(spread([15, 16, 16.1, 16.2, 19]) - 0.2 / 16.1) < 1e-12);
  assert.equal(spread([15, 16, 19, 16, 16]), 0);
});

test('frameTime: the mean of the frames', () => {
  assert.equal(frameTime([14, 14, 14, 20, 20, 20]), 17);
});
