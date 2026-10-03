import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTime, parseTTML, parseXmlLite, computeInterludes, TTMLParseError } from '../src/ttml-parser.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

const tt = (body, { timing = 'Word', head = '' } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal"${timing ? ` itunes:timing="${timing}"` : ''}>
  <head><metadata>${head}</metadata></head>
  <body dur="1:00.000">${body}</body>
</tt>`;

// ---------------------------------------------------------------------------
test('parseTime: clock forms', () => {
  close(parseTime('1:02:03.500'), 3723.5);
  close(parseTime('0:12.340'), 12.34);
  close(parseTime('03:14.000'), 194);
  close(parseTime('12.345'), 12.345);
  close(parseTime('7'), 7);
});

test('parseTime: offset forms', () => {
  close(parseTime('12.5s'), 12.5);
  close(parseTime('350ms'), 0.35);
  close(parseTime('2m'), 120);
  close(parseTime('1h'), 3600);
  close(parseTime('.5s'), 0.5);
});

test('parseTime: invalid / missing', () => {
  assert.equal(parseTime(null), null);
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('1:2:3:4:5'), null);
  assert.equal(parseTime('12x'), null);
});

// ---------------------------------------------------------------------------
test('xml lite: entities, CDATA, comments, self-closing', () => {
  const el = parseXmlLite('<?xml version="1.0"?><!-- c --><a x=\'1\' y="&amp;"><b/><![CDATA[<raw>]]>&lt;&#65;&#x42;</a>');
  assert.equal(el.name, 'a');
  assert.equal(el.attrs.y, '&');
  assert.equal(el.children[0].name, 'b');
  assert.equal(el.children[1].value, '<raw>');
  assert.equal(el.children[2].value, '<AB');
});

test('xml lite: mismatched tags throw', () => {
  assert.throws(() => parseXmlLite('<a><b></a>'), TTMLParseError);
  assert.throws(() => parseXmlLite('<a>'), TTMLParseError);
});

test('parseTTML: rejects non-TTML and broken XML', () => {
  assert.throws(() => parseTTML(''), TTMLParseError);
  assert.throws(() => parseTTML('<html></html>'), /Not a TTML/);
  assert.throws(() => parseTTML('<tt><body><p></body></tt>'), TTMLParseError);
});

// ---------------------------------------------------------------------------
test('word timing: words and per-syllable timing', () => {
  const m = parseTTML(tt(
    '<div><p begin="0:01.000" end="0:03.000"><span begin="1" end="1.5">Line</span> <span begin="1.5" end="2">one</span></p></div>',
  ));
  assert.equal(m.timing, 'word');
  assert.equal(m.lines.length, 1);
  const l = m.lines[0];
  assert.equal(l.mode, 'word');
  close(l.begin, 1); close(l.end, 3);
  assert.equal(l.text, 'Line one');
  assert.deepEqual(l.words.map((w) => w.text), ['Line', 'one']);
  close(l.words[1].syllables[0].begin, 1.5);
  close(l.words[1].syllables[0].end, 2);
  assert.equal(l.isBackground, false);
});

test('syllable grouping: adjacent spans form one word', () => {
  const m = parseTTML(tt(
    '<div><p begin="1" end="4"><span begin="1" end="1.4">Syl</span><span begin="1.4" end="1.8">la</span><span begin="1.8" end="2.2">ble</span> <span begin="2.2" end="3">test</span></p></div>',
  ));
  const [w1, w2] = m.lines[0].words;
  assert.equal(m.lines[0].words.length, 2);
  assert.equal(w1.text, 'Syllable');
  assert.deepEqual(w1.syllables.map((s) => s.text), ['Syl', 'la', 'ble']);
  close(w1.begin, 1); close(w1.end, 2.2);
  close(w1.syllables[1].begin, 1.4);
  assert.equal(w2.text, 'test');
});

test('syllable grouping: whitespace inside span text still splits words', () => {
  const m = parseTTML(tt('<div><p begin="1" end="3"><span begin="1" end="2">Word </span><span begin="2" end="3">next</span></p></div>'));
  assert.deepEqual(m.lines[0].words.map((w) => w.text), ['Word', 'next']);
});

test('syllable grouping: multi-word span splits time by character count', () => {
  const m = parseTTML(tt('<div><p begin="0" end="2"><span begin="0" end="2">ab cd</span></p></div>'));
  const [a, b] = m.lines[0].words;
  close(a.begin, 0); close(a.end, 1); close(b.begin, 1); close(b.end, 2);
});

test('CJK spans do not merge into one unbreakable word', () => {
  const m = parseTTML(tt('<div><p begin="0" end="2"><span begin="0" end="1">测</span><span begin="1" end="2">试</span></p></div>'));
  assert.equal(m.lines[0].words.length, 2);
});

// ---------------------------------------------------------------------------
test('background vocals: x-bg becomes a sub-line with own timing, parens stripped', () => {
  const m = parseTTML(tt(
    '<div><p begin="1" end="3"><span begin="1" end="2">Main</span> <span ttm:role="x-bg"><span begin="2" end="2.5">(back</span><span begin="2.5" end="3.5">ing)</span></span></p></div>',
  ));
  const l = m.lines[0];
  assert.equal(l.text, 'Main');
  assert.ok(l.background);
  assert.equal(l.background.isBackground, true);
  assert.equal(l.background.text, 'backing');
  assert.deepEqual(l.background.words[0].syllables.map((s) => s.text), ['back', 'ing']);
  close(l.background.begin, 2); close(l.background.end, 3.5);
});

test('translations: inline x-translation and head <translation> by itunes:key', () => {
  const head = '<iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation lang="fr"><text for="L2">Ligne deux</text></translation></translations></iTunesMetadata>';
  const m = parseTTML(tt(
    '<div><p begin="1" end="2"><span begin="1" end="2">One</span><span ttm:role="x-translation">Un</span></p>' +
    '<p begin="2" end="3" itunes:key="L2"><span begin="2" end="3">Two</span></p></div>',
    { head },
  ));
  assert.equal(m.lines[0].translation, 'Un');
  assert.equal(m.lines[0].text, 'One');
  assert.equal(m.lines[1].translation, 'Ligne deux');
  assert.equal(m.hasTranslation, true);
});

// ---------------------------------------------------------------------------
test('agents: second person right-aligned, group stays left', () => {
  const head = '<ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"><ttm:name type="full">Singer B</ttm:name></ttm:agent><ttm:agent type="group" xml:id="v1000"/>';
  const body = ['v1', 'v2', 'v1000', 'v1'].map((a, i) =>
    `<p begin="${i}" end="${i + 1}" ttm:agent="${a}"><span begin="${i}" end="${i + 1}">L${i}</span></p>`).join('');
  const m = parseTTML(tt(`<div>${body}</div>`, { head }));
  assert.equal(m.primaryAgent, 'v1');
  assert.deepEqual(m.lines.map((l) => l.isDuet), [false, true, false, false]);
  assert.deepEqual(m.lines.map((l) => l.agent), ['v1', 'v2', 'v1000', 'v1']);
  assert.equal(m.agents.v2.name, 'Singer B');
  assert.equal(m.agents.v1000.type, 'group');
});

test('song-part is carried from <div>', () => {
  const m = parseTTML(tt('<div itunes:song-part="Chorus"><p begin="1" end="2"><span begin="1" end="2">X</span></p></div>'));
  assert.equal(m.lines[0].songPart, 'Chorus');
});

// ---------------------------------------------------------------------------
test('line timing: whole <p> is one unit', () => {
  const m = parseTTML(tt('<div><p begin="0:05.000" end="0:08.000">Line one of the test song</p></div>', { timing: 'Line' }));
  assert.equal(m.timing, 'line');
  const l = m.lines[0];
  assert.equal(l.mode, 'line');
  close(l.begin, 5); close(l.end, 8);
  assert.equal(l.words.length, 6);
  for (const s of l.words.flatMap((w) => w.syllables)) { close(s.begin, 5); close(s.end, 8); }
});

test('timing inferred when itunes:timing is missing', () => {
  const m1 = parseTTML(tt('<div><p begin="1" end="2">Plain line</p></div>', { timing: null }));
  assert.equal(m1.timing, 'line');
  const m2 = parseTTML(tt('<div><p><span begin="1" end="2">A</span></p></div>', { timing: null }));
  assert.equal(m2.timing, 'word');
  close(m2.lines[0].begin, 1);
});

test('word-timed doc with an untimed-span line falls back to line mode', () => {
  const m = parseTTML(tt('<div><p begin="1" end="2"><span begin="1" end="2">A</span></p><p begin="3" end="5">Whole line</p></div>'));
  assert.equal(m.lines[0].mode, 'word');
  assert.equal(m.lines[1].mode, 'line');
});

test('untimed TTML: static lyrics', () => {
  const m = parseTTML(tt('<div><p>First</p><p>Second</p></div>', { timing: 'None' }));
  assert.equal(m.timing, 'none');
  assert.equal(m.lines.length, 2);
  assert.equal(m.lines[0].mode, 'none');
  assert.equal(m.lines[0].begin, null);
  assert.deepEqual(m.interludes, []);
});

test('missing syllable times are filled from neighbours', () => {
  const m = parseTTML(tt('<div><p begin="1" end="4"><span begin="1" end="2">a</span> <span>b</span> <span begin="3" end="4">c</span></p></div>'));
  const b = m.lines[0].words[1];
  close(b.begin, 2); close(b.end, 3);
});

// ---------------------------------------------------------------------------
test('interludes: before first line and gaps ≥ 4s', () => {
  const body = [[6, 8], [9, 11], [16, 18], [19.5, 21]].map(([b, e]) =>
    `<p begin="${b}" end="${e}"><span begin="${b}" end="${e}">x</span></p>`).join('');
  const m = parseTTML(tt(`<div>${body}</div>`));
  assert.equal(m.interludes.length, 2);
  assert.deepEqual(m.interludes[0], { begin: 0, end: 6, afterLine: -1, beforeLine: 0 });
  assert.deepEqual(m.interludes[1], { begin: 11, end: 16, afterLine: 1, beforeLine: 2 });
});

test('interludes: overlapping lines and background ends extend the gap start', () => {
  const lines = [
    { begin: 1, end: 10, background: null },
    { begin: 2, end: 3, background: null }, // overlaps line 0
    { begin: 12, end: 13, background: { end: 14 } },
    { begin: 17, end: 18, background: null },
  ];
  assert.deepEqual(computeInterludes(lines), []);
  assert.equal(computeInterludes(lines, 2).length, 2);
  assert.deepEqual(computeInterludes(lines, 3), [{ begin: 14, end: 17, afterLine: 2, beforeLine: 3 }]);
});

test('metadata from head: ttm:title and AMLL meta', () => {
  const head = '<ttm:title>Test Song</ttm:title><amll:meta xmlns:amll="http://www.example.com/ns/amll" key="artists" value="Test Artist"/>';
  const m = parseTTML(tt('<div><p begin="1" end="2">x</p></div>', { head }));
  assert.equal(m.meta.title, 'Test Song');
  assert.deepEqual(m.meta.artists, ['Test Artist']);
  close(m.duration, 60);
});

test('end-to-end: examples/demo.ttml (Apple-style, placeholder lyrics)', async () => {
  const { readFile } = await import('node:fs/promises');
  const m = parseTTML(await readFile(new URL('../examples/demo.ttml', import.meta.url), 'utf8'));
  assert.equal(m.timing, 'word');
  assert.equal(m.lines.length, 11);
  assert.equal(m.lines[0].text, 'Line one of the test song');
  assert.equal(m.lines[1].words[0].text, 'Syllables');
  assert.equal(m.lines[1].words[0].syllables.length, 3);
  assert.deepEqual(m.lines.map((l) => l.isDuet), [false, false, true, false, false, false, true, false, false, false, false]);
  assert.equal(m.lines[3].background.text, 'echo echo');
  assert.equal(m.interludes.length, 2);
  assert.equal(m.interludes[1].beforeLine, 5);
  assert.ok(m.hasTranslation);
  assert.deepEqual([...new Set(m.lines.map((l) => l.songPart))], ['Verse', 'Chorus']);
});
