import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTTML } from '../src/ttml-parser.js';
import { yrcLines, neteaseToTtml, neteaseUpstreamUrl } from '../src/netease.js';

const YRC = [
  '{"t":0,"c":[{"tx":"作词: "},{"tx":"Someone"}]}',
  '[630,2610](630,390,0)Couldn\'t (1020,240,0)beat (1260,90,0)her (1350,270,0)smile',
  '[3240,1740](3240,660,0)Secret (3900,300,0)side',
  '[5000,1000](5000,500,0)作曲: (5500,500,0)Nobody',
  '[6000,1200](6000,400,0)夜(6400,400,0)に(6800,400,0)駆',
].join('\n');

test('YRC lines and words (credit lines skipped)', () => {
  const lines = yrcLines(YRC);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0].words.map((w) => w.text), ["Couldn't ", 'beat ', 'her ', 'smile']);
  assert.equal(lines[0].begin, 630);
  assert.equal(lines[0].end, 3240);
  assert.equal(lines[0].words[1].begin, 1020);
  assert.equal(lines[0].words[1].end, 1260);
});

test('YRC → word-timed TTML with translations matched by time', () => {
  const payload = {
    yrc: { lyric: YRC },
    tlyric: { lyric: '[00:00.650]无法击败她的笑容\n[00:03.200]秘密的一面' },
  };
  const model = parseTTML(neteaseToTtml(payload, { title: 'T', artists: ['A'] }));
  assert.equal(model.timing, 'word');
  assert.equal(model.lines.length, 3);
  assert.equal(model.lines[0].text, "Couldn't beat her smile");
  assert.deepEqual(model.lines[0].words.map((w) => w.text), ["Couldn't", 'beat', 'her', 'smile']);
  assert.equal(model.lines[0].words[0].begin, 0.63);
  assert.equal(model.lines[0].translation, '无法击败她的笑容');
  assert.equal(model.lines[1].translation, '秘密的一面');
  assert.equal(model.lines[2].text, '夜に駆', 'CJK characters join without spaces');
});

test('falls back to LRC when there is no YRC', () => {
  const model = parseTTML(neteaseToTtml({ lrc: { lyric: '[00:00.00] 作词 : X\n[00:01.00]Hello\n[00:03.00]World' } }));
  assert.equal(model.timing, 'line');
  assert.deepEqual(model.lines.map((l) => l.text), ['Hello', 'World']);
});

test('no synced lyrics → clear error', () => {
  assert.throws(() => neteaseToTtml({ lrc: { lyric: 'plain text only' } }), /No synced lyrics/);
});

test('relay only allows search and lyric requests', () => {
  assert.match(neteaseUpstreamUrl('search', { s: 'idol', limit: '5' }), /^https:\/\/music\.163\.com\/api\/search\/get\?s=idol&type=1&limit=5$/);
  assert.match(neteaseUpstreamUrl('lyric', { id: '2048982668' }), /^https:\/\/music\.163\.com\/api\/song\/lyric\/v1\?id=2048982668&/);
  assert.throws(() => neteaseUpstreamUrl('lyric', { id: '1&evil=1' }), /bad id/);
  assert.throws(() => neteaseUpstreamUrl('other', {}), /unknown/);
  assert.throws(() => neteaseUpstreamUrl('search', { s: '  ' }), /missing/);
  assert.match(neteaseUpstreamUrl('search', { s: 'a', limit: '999' }), /limit=30$/);
});
