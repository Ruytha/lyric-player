import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, PlayLog, readPlays } from '../src/stats.js';
import { pickBlank, sameWord } from '../src/quiz.js';
import { buildLineTtml } from '../src/tap-sync.js';
import { parseTTML } from '../src/ttml-parser.js';
import { smartShuffled } from '../src/queue.js';
import { lyricsPlainText } from '../src/lyric-index.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RemoteServer } = require('../desktop/remote-server.cjs');

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('play log keeps songs heard 30 s or more', () => {
  const storage = memory();
  const log = new PlayLog({ storage });
  for (let i = 0; i < 40; i++) log.tick({ title: 'A', artist: 'X' }, true);
  for (let i = 0; i < 10; i++) log.tick({ title: 'B', artist: 'Y' }, true); // switching flushes A
  log.tick(null, false); // B: only 10 s
  const plays = readPlays(storage);
  assert.equal(plays.length, 1);
  assert.equal(plays[0].t, 'A');
  assert.equal(plays[0].s, 40);
});

test('stats: top songs, artists split on features, streaks', () => {
  const day = 86400000, t0 = new Date(2026, 0, 10, 21).getTime();
  const plays = [
    { t: 'One', a: 'Ann', at: t0, s: 200 },
    { t: 'One', a: 'Ann', at: t0 + day, s: 200 },
    { t: 'Two', a: 'Ann & Bob', at: t0 + 2 * day, s: 100 },
    { t: 'Three', a: 'Cy', at: t0 + 5 * day, s: 60 },
  ];
  const s = summarize(plays, 0, t0 + 10 * day);
  assert.equal(s.plays, 4);
  assert.equal(s.minutes, 9);
  assert.equal(s.songs[0].title, 'One');
  assert.deepEqual(s.artists.map((a) => a.name), ['Ann', 'Bob', 'Cy']);
  assert.equal(s.streak, 3);
  assert.equal(s.peakHour, 21);
});

test('quiz hides a real word and accepts answers without accents or case', () => {
  const words = 'I go delete my twitter uh'.split(' ').map((text) => ({ text }));
  const i = pickBlank(words, () => 0);
  assert.equal(words[i].text, 'twitter');
  assert.equal(pickBlank([{ text: 'oh' }, { text: 'yeah' }], () => 0), -1);
  assert.ok(sameWord('Café!', 'cafe'));
  assert.ok(!sameWord('', ''));
});

test('tap-to-sync makes TTML the player reads back', () => {
  const ttml = buildLineTtml(['First line', 'Second & last'], [1.5, 4.25], { title: 'Song', artist: 'Me', duration: 30 });
  const m = parseTTML(ttml);
  assert.equal(m.timing, 'line');
  assert.equal(m.lines.length, 2);
  assert.equal(m.lines[1].text, 'Second & last');
  assert.ok(Math.abs(m.lines[0].begin - 1.5) < 1e-6 && Math.abs(m.lines[0].end - 4.2) < 1e-6);
  assert.equal(m.meta.title, 'Song');
});

test('smart shuffle keeps every song and splits up artists', () => {
  const info = { a: { artist: 'X' }, b: { artist: 'X' }, c: { artist: 'Y' }, d: { artist: 'Z' }, e: { artist: 'X' }, f: { artist: 'W' } };
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 20; k++) {
    const out = smartShuffled(Object.keys(info), (id) => info[id], { rand });
    assert.deepEqual([...out].sort(), Object.keys(info));
    for (let i = 1; i < out.length - 1; i++) assert.ok(info[out[i]].artist !== info[out[i - 1]].artist || info[out[i]].artist === 'X', 'only unavoidable repeats');
  }
});

test('lyrics text for search skips translations', () => {
  const ttml = '<tt><head></head><body><div><p begin="1" end="2"><span begin="1" end="1.5">Hello</span> <span begin="1.5" end="2">there</span><span ttm:role="x-translation">Hola</span></p><p begin="3" end="4">Tom &amp; Jerry</p></div></body></tt>';
  assert.equal(lyricsPlainText(ttml), 'Hello there\nTom & Jerry');
});

test('phone remote answers only with the code', async () => {
  const cmds = [];
  const r = new RemoteServer({ getRoot: () => process.cwd(), onCommand: (c) => cmds.push(c) });
  await r.start('secret123', 17781);
  try {
    const base = `http://127.0.0.1:${r.port}`;
    assert.equal((await fetch(`${base}/?t=wrong`)).status, 403);
    assert.equal((await fetch(`${base}/`)).status, 403);
    const page = await fetch(`${base}/?t=secret123`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /remote\.js/);
    assert.equal((await fetch(`${base}/src/remote.js`)).status, 200);
    assert.equal((await fetch(`${base}/src/main.js`)).status, 403, 'other player files are not served');
    const ok = await fetch(`${base}/api/cmd?t=secret123`, { method: 'POST', body: JSON.stringify({ cmd: 'seek', value: 42 }) });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${base}/api/cmd?t=secret123`, { method: 'POST', body: JSON.stringify({ cmd: 'quit' }) })).status, 400);
    assert.deepEqual(cmds, [{ cmd: 'seek', value: 42 }]);
    r.setToken('newcode');
    assert.equal((await fetch(`${base}/?t=secret123`)).status, 403, 'old code stops working');
  } finally { r.stop(); }
});
