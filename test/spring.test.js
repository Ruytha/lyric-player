import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Spring, solveSpring } from '../src/spring.js';

const run = (sp, seconds, fps = 60) => {
  const out = [];
  for (let i = 0; i < seconds * fps; i++) { sp.step(1 / fps); out.push(sp.value); }
  return out;
};

test('critically damped: no overshoot, ~50% at 1.68/ω and ~90% at 3.89/ω', () => {
  // The scroll spring measured from the reference video: 50% ≈ 115 ms, 90% ≈ 265 ms.
  const k = 190, m = 0.9, w = Math.sqrt(k / m);
  const f = solveSpring(0, 0, 100, k, 40, m); // damping above critical → treated as critical
  assert.ok(Math.abs(f(1.68 / w)[0] - 50) < 1);
  assert.ok(Math.abs(f(3.89 / w)[0] - 90) < 1);
  const sp = new Spring({ stiffness: k, damping: 40, mass: m });
  sp.setTarget(100);
  const xs = run(sp, 1.5);
  assert.ok(Math.max(...xs) <= 100.0001, 'never overshoots');
  assert.equal(sp.value, 100);
  assert.ok(sp.settled);
});

test('underdamped springs overshoot and settle', () => {
  const sp = new Spring({ stiffness: 100, damping: 8, mass: 1, value: 0.97, precision: 0.0005 });
  sp.setTarget(1);
  const xs = run(sp, 3);
  assert.ok(Math.max(...xs) > 1, 'overshoots a little');
  assert.equal(sp.value, 1);
});

test('velocity carries over when the target changes mid-flight', () => {
  const sp = new Spring({ stiffness: 170, damping: 30, mass: 0.9 });
  sp.setTarget(100);
  run(sp, 0.1);
  const v = sp.velocity;
  assert.ok(v > 0);
  sp.setTarget(200);
  assert.ok(Math.abs(sp.velocity - v) < 1e-9);
  const before = sp.value;
  sp.step(1 / 60);
  assert.ok(sp.value > before, 'keeps moving the same way, no jolt');
});

test('delayed targets wait, then move', () => {
  const sp = new Spring({ stiffness: 170, damping: 30, mass: 0.9 });
  sp.setTarget(50, 0.2);
  run(sp, 0.15);
  assert.equal(sp.value, 0);
  run(sp, 0.1);
  assert.ok(sp.value > 0);
  assert.equal(sp.settled, false);
});

test('motion is frame-rate independent', () => {
  const a = new Spring({ stiffness: 200, damping: 30 }), b = new Spring({ stiffness: 200, damping: 30 });
  a.setTarget(100); b.setTarget(100);
  run(a, 0.2, 30); run(b, 0.2, 144);
  assert.ok(Math.abs(a.value - b.value) < 0.5);
});
