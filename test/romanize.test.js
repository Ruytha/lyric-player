import { test } from 'node:test';
import assert from 'node:assert/strict';
import { romanizeHangul, romanizeKana, scriptOf, romanizeLocally, mergeRomanization, clearAddedRomanization, lrcEntries } from '../src/romanize.js';
import { entriesSince } from '../src/whats-new.js';

test('Korean: Revised Romanization with linking and common sound changes', () => {
  assert.equal(romanizeHangul('사랑해'), 'saranghae');
  assert.equal(romanizeHangul('한국어'), 'hangugeo');
  assert.equal(romanizeHangul('신라'), 'silla');
  assert.equal(romanizeHangul('감사합니다'), 'gamsahamnida');
  assert.equal(romanizeHangul('너를 좋아해'), 'neoreul joahae');
  assert.equal(romanizeHangul('밤 하늘'), 'bam haneul');
});

test('Japanese kana: Hepburn, small kana, double consonants, long vowels', () => {
  assert.equal(romanizeKana('ありがとう'), 'arigatou');
  assert.equal(romanizeKana('きょう'), 'kyou');
  assert.equal(romanizeKana('しゃしん'), 'shashin');
  assert.equal(romanizeKana('ちょっと'), 'chotto');
  assert.equal(romanizeKana('マッチ'), 'matchi');
  assert.equal(romanizeKana('ラーメン'), 'raamen');
  assert.equal(romanizeKana('きんようび'), 'kin\'youbi');
  assert.equal(romanizeKana('ファン'), 'fan');
});

test('which lines can be romanized here', () => {
  assert.equal(scriptOf('Hello'), null);
  assert.equal(scriptOf('사랑'), 'ko');
  assert.equal(scriptOf('ありがとう'), 'kana');
  assert.equal(scriptOf('無敵の笑顔で'), 'han');
  const model = { lines: [{ text: 'ありがとう' }, { text: '無敵の笑顔で', begin: 10 }, { text: 'Yeah' }, { text: '既に', romanization: 'sude ni' }] };
  assert.deepEqual(romanizeLocally(model), { done: 1, needsLookup: true });
  assert.equal(model.lines[0].romanization, 'arigatou');
  assert.equal(model.lines[3].romanization, 'sude ni', "the TTML's own stays");
  clearAddedRomanization(model);
  assert.equal(model.lines[0].romanization, null);
  assert.equal(model.lines[3].romanization, 'sude ni');
});

test('borrowed romanization lines up by start time', () => {
  const model = { lines: [
    { text: '無敵の笑顔で', begin: 10.0 }, { text: '荒らすメディア', begin: 13.2 }, { text: '知りたいその秘密ミステリアス', begin: 16.5 },
  ] };
  const lrc = '[by:someone]\n[00:10.05]muteki no egao de\n[00:13.30]arasu media\n[00:16.40]shiritai sono himitsu misuteriasu\n[00:20.00]extra';
  const entries = lrcEntries(lrc);
  assert.equal(entries.length, 4);
  assert.equal(mergeRomanization(model, entries), 3);
  assert.equal(model.lines[1].romanization, 'arasu media');
  // A different version (nothing lines up) is left alone.
  const other = { lines: [{ text: '無敵', begin: 50 }, { text: '笑顔', begin: 70 }] };
  assert.equal(mergeRomanization(other, entries), 0);
  assert.equal(other.lines[0].romanization, undefined);
});

test("what's new lists the versions since the one you last saw", () => {
  const log = [{ version: '2.4.0' }, { version: '2.3.0' }, { version: '2.2.1' }];
  assert.deepEqual(entriesSince(log, '2.2.1').map((e) => e.version), ['2.4.0', '2.3.0']);
  assert.deepEqual(entriesSince(log, '2.4.0'), []);
});
