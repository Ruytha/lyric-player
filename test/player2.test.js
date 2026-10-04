import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Queue } from '../src/queue.js';
import { pickBestLyrics, lyricsMatch, fetchBestLyrics } from '../src/auto-lyrics.js';
import { shiftParagraphs, formatTime } from '../src/ttml-edit.js';
import { parseTTML } from '../src/ttml-parser.js';
import { Scrobbler } from '../src/scrobbler.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('queue: next / previous / repeat', () => {
  const q = new Queue({ storage: memory() });
  assert.equal(q.set(['a', 'b', 'c'], 'b'), 'b');
  assert.equal(q.next(), 'c');
  assert.equal(q.next(), null, 'end of the queue');
  q.cycleRepeat(); // all
  assert.equal(q.next(), 'a', 'repeat all wraps');
  assert.equal(q.prev(), 'c', 'and backwards');
  q.cycleRepeat(); // one
  assert.equal(q.next({ auto: true }), 'c', 'repeat one replays when the song ends');
  assert.equal(q.next(), 'a', 'but the next button still moves on');
});

test('queue: play next, add, move, remove, shuffle keeps the current song', () => {
  const q = new Queue({ storage: memory() });
  q.set(['a', 'b', 'c', 'd'], 'a');
  q.playNext('d');
  assert.deepEqual(q.items, ['a', 'd', 'b', 'c']);
  q.add('a2');
  assert.deepEqual(q.upcoming, ['d', 'b', 'c', 'a2']);
  q.move(1, 3);
  assert.deepEqual(q.items, ['a', 'b', 'c', 'd', 'a2']);
  q.remove(2);
  assert.deepEqual(q.items, ['a', 'b', 'd', 'a2']);
  q.setShuffle(true);
  assert.equal(q.current, 'a');
  assert.equal(q.items.length, 4);
  assert.deepEqual([...q.items].sort(), ['a', 'a2', 'b', 'd']);
  q.setShuffle(false);
  assert.deepEqual(q.items, ['a', 'b', 'd', 'a2'], 'unshuffle restores the order');
});

test('queue survives a reload', () => {
  const storage = memory();
  const q = new Queue({ storage });
  q.set(['x', 'y'], 'y');
  q.cycleRepeat();
  const q2 = new Queue({ storage });
  assert.equal(q2.current, 'y');
  assert.equal(q2.repeat, 'all');
});

test('automatic lyrics pick the right song, prefer word sync, reject other versions', () => {
  const song = { title: 'Cruel Summer', artist: 'Taylor Swift', duration: 178 };
  const results = [
    { source: 'lrclib', title: 'Cruel Summer', artists: ['Taylor Swift'], duration: 178, synced: true },
    { source: 'netease', title: 'Cruel Summer', artists: ['Taylor Swift'], duration: 178, wordSync: true },
    { source: 'qq', title: 'Cruel Summer (Live)', artists: ['Taylor Swift'], duration: 229, wordSync: true },
    { source: 'netease', title: 'Cruel Summer', artists: ['Bananarama'], duration: 210, wordSync: true },
  ];
  assert.equal(pickBestLyrics(results, song), results[1]);
  assert.equal(lyricsMatch(results[2], song), 0, 'a 50 s longer live version is a different recording');
  assert.equal(lyricsMatch(results[3], song), 0, 'different artist');
  assert.equal(pickBestLyrics([{ source: 'lrclib', title: 'Something Else', artists: ['Taylor Swift'] }], song), null);
});

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
<p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:02.000">Hello</span> <span begin="00:02.000" end="00:03.000">world</span></p>
<p begin="00:04.000" end="00:06.000" ttm:agent="v1"><span begin="4s" end="5s">Second</span><span ttm:role="x-bg"><span begin="00:05.000" end="00:06.000">(echo)</span></span></p>
</div></body></tt>`;

test('timing edits shift one line (words and background vocals too) and nothing else', () => {
  const out = shiftParagraphs(TTML, new Map([[1, 0.25]]));
  const m = parseTTML(out);
  assert.equal(m.lines[0].begin, 1);
  assert.equal(m.lines[1].begin, 4.25);
  assert.equal(m.lines[1].words[0].begin, 4.25);
  assert.equal(m.lines[1].background.words[0].begin, 5.25);
  assert.ok(out.includes('ttm:agent="v1"'), 'other attributes untouched');
  assert.equal(m.lines[1].pIndex, 1);
  assert.equal(shiftParagraphs(TTML, new Map()), TTML);
  assert.equal(formatTime(65.4321), '01:05.432');
  assert.equal(formatTime(3725), '1:02:05.000');
});

test('scrobbles after half the song (or 4 min), counting real listening only', () => {
  const sent = [];
  const s = new Scrobbler((kind, t) => { sent.push([kind, t.title]); return Promise.resolve(true); });
  s.start({ title: 'Song', artist: 'Artist', duration: 200 });
  assert.deepEqual(sent, [['now-playing', 'Song']]);
  s.tick(0, true);
  s.tick(150, true); // a seek: doesn't count
  for (let t = 151; t <= 199; t++) s.tick(t, true);
  assert.equal(sent.length, 1, 'only ~48 s really heard');
  const s2 = new Scrobbler((kind, t) => { sent.push([kind, t.title]); return Promise.resolve(true); });
  s2.start({ title: 'Two', artist: 'Artist', duration: 200 });
  for (let t = 0; t <= 101; t++) s2.tick(t, true);
  assert.deepEqual(sent.at(-1), ['scrobble', 'Two']);
  const s3 = new Scrobbler((kind) => { sent.push([kind]); return Promise.resolve(true); });
  s3.start({ title: 'Short', artist: 'A', duration: 20 });
  for (let t = 0; t <= 20; t++) s3.tick(t, true);
  assert.notDeepEqual(sent.at(-1), ['scrobble'], 'songs under 30 s are never scrobbled');
});

test('Apple Music lyrics win over BiniLyrics, and a failing source falls through to the next', async () => {
  const song = { title: 'Where Our Blue Is', artist: 'Tatsuya Kitani', duration: 199 };
  const results = [
    { source: 'apple', id: '1692289314', title: 'Where Our Blue Is', artists: ['Tatsuya Kitani'], duration: 199, synced: true, wordSync: null },
    { source: 'bini', title: 'Where Our Blue Is', artists: ['Tatsuya Kitani'], duration: 199, wordSync: true },
  ];
  assert.equal(pickBestLyrics(results, song), results[0]);
  const failed = [];
  const found = await fetchBestLyrics(results, song, async (r) => {
    if (r.source === 'apple') throw new Error('Apple Music has no lyrics for this song');
    return '<tt/>';
  }, (r) => failed.push(r.source));
  assert.equal(found.best, results[1]);
  assert.deepEqual(failed, ['apple']);
  assert.equal(await fetchBestLyrics([], song, async () => '<tt/>'), null);
});
