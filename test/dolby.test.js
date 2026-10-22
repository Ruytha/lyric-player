import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDolby } from '../src/dolby.js';

const bytes = (s) => new TextEncoder().encode(s);

test('Dolby audio is found by its MP4 sample entry or a raw-stream file name', () => {
  assert.equal(isDolby(bytes('....stsd....ec-3....dec3'), 'Song.m4a'), true);
  assert.equal(isDolby(bytes('....stsd....ac-3....'), 'Song.mp4'), true);
  assert.equal(isDolby(bytes('\x0bw'), 'Song.eac3'), true);
  assert.equal(isDolby(bytes('....stsd....mp4a....esds'), 'Song.m4a'), false);
});
