import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDolby, isAtmos, loudnessGain } from '../src/dolby.js';

const bytes = (s) => new TextEncoder().encode(s);

test('Dolby audio is found by its MP4 sample entry or a raw-stream file name', () => {
  assert.equal(isDolby(bytes('....stsd....ec-3....dec3'), 'Song.m4a'), true);
  assert.equal(isDolby(bytes('....stsd....ac-3....'), 'Song.mp4'), true);
  assert.equal(isDolby(bytes('\x0bw'), 'Song.eac3'), true);
  assert.equal(isDolby(bytes('....stsd....mp4a....esds'), 'Song.m4a'), false);
});

test('Atmos is raised toward -10 LUFS, with the limiter taking at most 3 dB off the peaks', () => {
  const summary = (i, peak) => `Integrated loudness:\n    I:         ${i} LUFS\n  True peak:\n    Peak:       ${peak} dBFS`;
  assert.equal(loudnessGain(summary(-17.3, -7.5)), 7.3); // Blinding Lights: loudness decides
  assert.equal(loudnessGain(summary(-20, -1)), 3); // peaks near full scale: capped
  assert.equal(loudnessGain(summary(-8, -0.5)), 0); // already loud: never turned down
  assert.equal(loudnessGain('no summary'), 0);
});

test('Atmos is read from the dec3 box: the JOC extension flag after the substreams', () => {
  const box = (payload) => new Uint8Array([0, 0, 0, 8 + payload.length, ...new TextEncoder().encode('dec3'), ...payload]);
  const plain = [0x18, 0x00, 0x20, 0x0f, 0x00]; // 768 kb/s, one 5.1 substream (from Blinding Lights)
  assert.equal(isAtmos(box([...plain, 0x01, 0x10])), true); // + flag_ec3_extension_type_a, complexity 16
  assert.equal(isAtmos(box(plain)), false);
  assert.equal(isAtmos(new TextEncoder().encode('no dolby here')), false);
});
