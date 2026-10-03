import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSamples, tempoRatio, planMix, alignedPosition, gridNear } from '../src/automix.js';

const SR = 22050;

/** A drum loop: kick on every beat, hats in between, quiet pad, with silence around it. */
function track({ bpm, first, secs, lead = 0, trail = 0, seed = 1 }) {
  const n = Math.floor((lead + secs + trail) * SR);
  const x = new Float32Array(n);
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const period = 60 / bpm;
  for (let i = Math.floor(lead * SR); i < (lead + secs) * SR; i++) x[i] = 0.02 * Math.sin(2 * Math.PI * 220 * i / SR) + 0.01 * rand();
  for (let t = lead + first; t < lead + secs - 0.3; t += period) {
    const k0 = Math.floor(t * SR);
    for (let j = 0; j < 0.18 * SR && k0 + j < n; j++) x[k0 + j] += 0.8 * Math.exp(-j / (0.04 * SR)) * Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-j / (0.01 * SR))) * j / SR);
    const h = Math.floor((t + period / 2) * SR);
    for (let j = 0; j < 0.03 * SR && h + j < n; j++) x[h + j] += 0.15 * Math.exp(-j / (0.005 * SR)) * rand();
  }
  return x;
}

for (const [bpm, first] of [[128, 0.21], [97, 0.4], [140, 0.05], [174, 0.3]]) {
  test(`finds ${bpm} BPM and where its beats fall`, () => {
    const a = analyzeSamples(track({ bpm, first, secs: 40, lead: 1.5, trail: 3 }), SR);
    // 174 BPM folds to the half tempo, which is fine for mixing.
    const want = bpm >= 160 ? bpm / 2 : bpm;
    assert.ok(Math.abs(a.bpm - want) < 0.6, `bpm ${a.bpm.toFixed(2)} ≈ ${want}`);
    // Beats near the end and near the start land on a kick (any kick, for folded tempos).
    const kick = 60 / bpm, beat = 1.5 + first;
    for (const [t0, t1] of [[28, 41], [1.5, 16]]) {
      const g = gridNear(a, t0, t1);
      const err = ((((g.offset - beat) / kick) % 1) + 1.5) % 1 - 0.5;
      assert.ok(Math.abs(err * kick) < 0.02, `beat phase near ${t0}s off by ${(err * kick * 1000).toFixed(0)} ms`);
    }
    assert.ok(Math.abs(a.start - 1.5) < 0.1, `start ${a.start.toFixed(2)}`);
    assert.ok(Math.abs(a.end - 41.5) < 0.5, `end ${a.end.toFixed(2)}`);
  });
}

test('tempo ratio: small differences match, half/double tempo too, far ones don’t', () => {
  assert.ok(Math.abs(tempoRatio(128, 124) - 128 / 124) < 1e-9);
  assert.ok(Math.abs(tempoRatio(128, 65) - 128 / 130) < 1e-9);
  assert.equal(tempoRatio(128, 100), 1);
});

test('mix plan starts on a beat before the end; incoming beats line up', () => {
  const a = { bpm: 120, period: 0.5, offset: 0.1, start: 0.5, end: 200.3, duration: 205 };
  const b = { bpm: 124, period: 60 / 124, offset: 0.33, start: 1.2, end: 180, duration: 185 };
  const p = planMix(a, b);
  assert.ok(p.synced);
  assert.ok(Math.abs(((p.at - a.offset) / a.period) % 1) < 1e-6, 'starts on a beat');
  assert.ok(p.at + p.secs <= a.end + 1e-6);
  assert.ok(Math.abs(p.rate - 120 / 124) < 1e-9);
  // A quarter into an outgoing beat → a quarter into an incoming beat.
  const pos = alignedPosition(a, b, a.offset + 10 * a.period + 0.125, p.inAt);
  const phase = ((pos - b.offset) / b.period) % 1;
  assert.ok(Math.abs(phase - 0.25) < 1e-6, `phase ${phase}`);
  assert.ok(Math.abs(pos - p.inAt) < b.period);
});
