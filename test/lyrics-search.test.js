import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTTML } from '../src/ttml-parser.js';
import { lrcToTtml, scoreMatch } from '../src/lyrics-search.js';

test('line-synced LRC becomes line-timed TTML', () => {
  const lrc = '[00:01.50] First line here\n[00:04.00] Second & "quoted" <line>\n[00:07.25]\n[00:09.00] Last one';
  const model = parseTTML(lrcToTtml(lrc, { title: 'Test', artists: ['Someone'] }));
  assert.equal(model.timing, 'line');
  assert.equal(model.lines.length, 3);
  assert.equal(model.lines[0].begin, 1.5);
  assert.equal(model.lines[0].end, 4);
  assert.equal(model.lines[1].text, 'Second & "quoted" <line>');
  assert.equal(model.lines[1].end, 7.25, 'ends at the gap marker');
  assert.equal(model.lines[2].end, 14, 'last line lasts 5 s');
});

test('enhanced LRC keeps word timing', () => {
  const lrc = '[00:02.00] <00:02.00> Hello <00:02.60> there <00:03.10> world <00:04.00>\n[00:05.00] <00:05.00> Next <00:05.50> line';
  const model = parseTTML(lrcToTtml(lrc));
  assert.equal(model.timing, 'word');
  const words = model.lines[0].words;
  assert.deepEqual(words.map((w) => w.text), ['Hello', 'there', 'world']);
  assert.equal(words[1].begin, 2.6);
  assert.equal(words[2].end, 4);
});

test('repeated timestamps on one line expand to several lines', () => {
  const model = parseTTML(lrcToTtml('[00:01.00][00:10.00] Chorus\n[00:05.00] Verse'));
  assert.deepEqual(model.lines.map((l) => [l.begin, l.text]), [[1, 'Chorus'], [5, 'Verse'], [10, 'Chorus']]);
});

test('search matching: all words must match, exact titles rank first', () => {
  const song = { title: 'Idol', artists: ['YOASOBI'], album: 'Idol' };
  assert.ok(scoreMatch('idol yoasobi', song) > 0);
  assert.ok(scoreMatch('Yoasobi', song) > 0);
  assert.equal(scoreMatch('idol taylor', song), 0);
  const other = { title: 'Idolize', artists: ['X'], album: '' };
  assert.ok(scoreMatch('idol', other) > 0, 'partial words match while typing');
  assert.ok(scoreMatch('idol', song) > scoreMatch('idol', other), 'exact title ranks higher');
  assert.equal(scoreMatch('dol', song), 0, 'only from the start of a word');
  assert.ok(scoreMatch('beyonce', { title: 'Halo', artists: ['Beyoncé'] }) > 0, 'accents are ignored');
});
