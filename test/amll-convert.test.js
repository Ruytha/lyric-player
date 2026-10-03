import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTTML } from '../src/ttml-parser.js';
import { toAmllLines } from '../src/amll-convert.js';

const model = parseTTML(readFileSync(new URL('../examples/demo.ttml', import.meta.url), 'utf8'));

test('syllables become AMLL words; words end with a space except the last', () => {
  const lines = toAmllLines(model);
  const first = lines[0];
  assert.equal(first.words.map((w) => w.word).join(''), model.lines[0].text);
  assert.equal(first.startTime, Math.round(model.lines[0].begin * 1000));
  assert.ok(!first.words.at(-1).word.endsWith(' '));
  // "vocal" = "vo" + "cal " stays one word for AMLL (no space inside)
  const l4 = lines.find((l) => l.words.some((w) => w.word === 'vo'));
  const i = l4.words.findIndex((w) => w.word === 'vo');
  assert.equal(l4.words[i + 1].word, 'cal ');
});

test('background vocals follow their line as an isBG line; duets keep isDuet', () => {
  const lines = toAmllLines(model);
  const bgIdx = lines.findIndex((l) => l.isBG);
  assert.ok(bgIdx > 0);
  assert.equal(lines[bgIdx - 1].isBG, false);
  assert.equal(lines[bgIdx].words.map((w) => w.word).join(''), 'echo echo');
  assert.ok(lines.some((l) => l.isDuet && !l.isBG));
});

test('translations can be hidden', () => {
  assert.ok(toAmllLines(model).some((l) => l.translatedLyric));
  assert.ok(toAmllLines(model, { translation: false }).every((l) => l.translatedLyric === ''));
});
