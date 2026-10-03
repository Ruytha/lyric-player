import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackClock } from '../src/clock.js';

function fakeAudio() {
  const listeners = {};
  return {
    paused: false, ended: false, seeking: false, readyState: 4, playbackRate: 1, currentTime: 0,
    addEventListener(ev, fn) { (listeners[ev] ??= []).push(fn); },
    emit(ev) { for (const fn of listeners[ev] || []) fn(); },
  };
}

test('jittery audio time becomes an even, monotonic clock', () => {
  const audio = fakeAudio();
  const clock = new PlaybackClock(audio);
  let rnd = 1;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const steps = [];
  let prev = null;
  for (let f = 0; f < 600; f++) {
    const now = f * (1000 / 60);
    // currentTime updates every ~15–40 ms and lags real time by 0–30 ms.
    if (rand() < 0.5) audio.currentTime = Math.max(audio.currentTime, now / 1000 - rand() * 0.03);
    const t = clock.tick(now);
    if (prev != null && f > 60) steps.push(t - prev);
    prev = t;
  }
  const min = Math.min(...steps), max = Math.max(...steps);
  assert.ok(min >= 0, 'never runs backwards');
  assert.ok(min > 0.0155 && max < 0.0178, `steady steps (${min.toFixed(4)}–${max.toFixed(4)} s per 16.7 ms frame)`);
  assert.ok(Math.abs(prev - 10) < 0.05, 'tracks the audio');
});

test('seeks snap, both ways', () => {
  const audio = fakeAudio();
  const clock = new PlaybackClock(audio);
  for (let f = 0; f < 120; f++) { audio.currentTime = f / 60; clock.tick(f * 1000 / 60); }
  audio.currentTime = 0.5;
  assert.ok(Math.abs(clock.tick(121 * 1000 / 60) - 0.5) < 0.001);
  audio.currentTime = 30;
  assert.ok(Math.abs(clock.tick(122 * 1000 / 60) - 30) < 0.001);
});
