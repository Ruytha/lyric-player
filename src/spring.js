// Analytic damped spring, stepped from the rAF loop.
//
// Each retarget solves the spring equation in closed form from the current
// position and velocity, so motion stays smooth when targets change mid-flight
// and doesn't depend on frame rate. Damping ratios ≥ 1 are treated as exactly
// critical — the fastest motion that never overshoots — which is what makes
// lyric scrolling feel fluid rather than sluggish.
//
// setTarget(target, delay) supports the staggered "cascade" of lyric lines.

export class Spring {
  constructor({ stiffness = 170, damping = 26, mass = 1, value = 0, precision = 0.05 } = {}) {
    this.stiffness = stiffness;
    this.damping = damping;
    this.mass = mass;
    this.precision = precision;
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.pending = null; // { target, delay }
    this.resting = true;
    this.t = 0;
    this.solve = null;
  }

  get settled() {
    return this.resting && !this.pending;
  }

  /** Change physics; takes effect from the current state. */
  setParams({ stiffness = this.stiffness, damping = this.damping, mass = this.mass }) {
    if (stiffness === this.stiffness && damping === this.damping && mass === this.mass) return;
    this.stiffness = stiffness;
    this.damping = damping;
    this.mass = mass;
    if (!this.resting) this.retarget(this.target);
  }

  /** Move towards `target`, optionally after `delay` seconds. */
  setTarget(target, delay = 0) {
    if (delay > 0) {
      this.pending = { target, delay };
      return;
    }
    this.pending = null;
    if (target === this.target && this.resting) return;
    this.retarget(target);
  }

  /** Snap to a value with no motion. */
  jump(value) {
    this.pending = null;
    this.value = this.target = value;
    this.velocity = 0;
    this.resting = true;
    this.solve = null;
  }

  retarget(target) {
    this.target = target;
    this.t = 0;
    this.resting = false;
    this.solve = solveSpring(this.value, this.velocity, target, this.stiffness, this.damping, this.mass);
  }

  /** Advance by dt seconds. Returns true while moving or waiting to move. */
  step(dt) {
    if (this.pending) {
      this.pending.delay -= dt;
      if (this.pending.delay > 0) {
        if (this.resting) return true;
      } else {
        // Spend whatever's left of this frame already moving to the new target.
        const spill = Math.min(dt, -this.pending.delay);
        const t = this.pending.target;
        this.pending = null;
        if (!this.resting) this.advance(dt - spill);
        this.retarget(t);
        dt = spill;
      }
    }
    if (this.resting) return !!this.pending;
    this.advance(dt);
    if (Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision * 4) {
      this.value = this.target;
      this.velocity = 0;
      this.resting = true;
    }
    return !this.resting || !!this.pending;
  }

  advance(dt) {
    if (dt <= 0 || !this.solve) return;
    this.t += Math.min(dt, 0.1);
    const [x, v] = this.solve(this.t);
    this.value = x;
    this.velocity = v;
  }
}

/** Closed-form solution: returns t → [position, velocity]. */
export function solveSpring(from, velocity, to, stiffness, damping, mass) {
  const d0 = from - to;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta >= 1) {
    const b = velocity + w0 * d0;
    return (t) => {
      const e = Math.exp(-w0 * t);
      return [to + (d0 + b * t) * e, (b - w0 * (d0 + b * t)) * e];
    };
  }
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const a = zeta * w0;
  const b = (velocity + a * d0) / wd;
  return (t) => {
    const e = Math.exp(-a * t);
    const c = Math.cos(wd * t), s = Math.sin(wd * t);
    const x = e * (d0 * c + b * s);
    const v = e * ((b * wd - a * d0) * c - (d0 * wd + a * b) * s);
    return [to + x, v];
  };
}
