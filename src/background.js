// Animated, heavily blurred artwork background.
//
// Equivalent to stacking 3 rotating copies of the cover with
// `filter: blur(~100px) saturate(1.4)`, but rendered into a canvas at 1/12 of
// the viewport resolution and upscaled by CSS. The blur radius scales down
// with the canvas, so it costs a few hundred thousand pixel ops per frame
// instead of re-blurring a full-screen layer on every frame.

import { Spring } from './spring.js';

const SCALE = 1 / 12;
const BLUR_CSS_PX = 100;
const FPS = 30;

// Three layers: size (× canvas diagonal), rotation period (s), orbit radius & period, alpha.
const LAYERS = [
  { size: 1.5, spin: 48, orbit: 0.06, orbitPeriod: 37, phase: 0, alpha: 1 },
  { size: 1.15, spin: -60, orbit: 0.22, orbitPeriod: 53, phase: 2.1, alpha: 0.85 },
  { size: 0.9, spin: 36, orbit: 0.28, orbitPeriod: 44, phase: 4.2, alpha: 0.75 },
];

function placeholderSource() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, '#56677f');
  grad.addColorStop(0.5, '#3a4659');
  grad.addColorStop(1, '#262d3a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** Downscale any drawable to a small square canvas (cheap to redraw every frame). */
function toThumb(src) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d');
  const w = src.naturalWidth || src.width, hh = src.naturalHeight || src.height;
  const s = Math.min(w, hh);
  g.drawImage(src, (w - s) / 2, (hh - s) / 2, s, s, 0, 0, 96, 96);
  return c;
}

export class ArtworkBackground {
  constructor(container) {
    this.canvas = document.createElement('canvas');
    container.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.hasFilter = 'filter' in this.ctx;
    if (!this.hasFilter) this.canvas.style.filter = `blur(${BLUR_CSS_PX}px) saturate(1.4)`;
    this.container = container;
    // Music reaction: a slightly bouncy "pulse" on the kick, faster flow and a
    // brighter, more saturated wash while the song is loud.
    this.pulse = new Spring({ stiffness: 320, damping: 18, mass: 1, value: 1, precision: 0.0002 });
    this.lastPulse = 1;
    this.lastLift = -1;
    this.energy = 0;
    this.current = toThumb(placeholderSource());
    this.previous = null;
    this.fade = 1;
    this.time = Math.random() * 100;
    this.acc = 0;
    this.dirty = true;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.canvas.width = Math.max(16, Math.ceil(innerWidth * SCALE));
    this.canvas.height = Math.max(16, Math.ceil(innerHeight * SCALE));
    this.dirty = true;
  }

  /** Accepts an image URL, an <img>/canvas, or null for the neutral placeholder. */
  async setImage(src) {
    let thumb;
    try {
      if (!src) thumb = toThumb(placeholderSource());
      else if (typeof src === 'string') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src;
        await img.decode();
        thumb = toThumb(img);
      } else thumb = toThumb(src);
    } catch {
      thumb = toThumb(placeholderSource());
    }
    this.previous = this.current;
    this.current = thumb;
    this.fade = 0;
    this.dirty = true;
  }

  setActive(on) {
    this.active = on;
    this.canvas.hidden = !on;
    if (on) this.dirty = true;
  }

  /** Settings from settings.js (shared with AmllBackground). */
  apply(s) {
    this.react = s.bgReact;
    this.pulseAmount = s.bgPulse;
    this.flow = s.bgFlow;
    this.still = s.bgStatic;
    this.dirty = true;
  }

  /** reactor: { bass, energy } in 0..1 (optional). */
  update(dt, playing, reactor = null) {
    if (this.active === false) return;
    const react = this.react ?? 1;
    const bass = (reactor?.bass || 0) * react, energy = (reactor?.energy || 0) * react;
    this.energy = energy;
    if (playing && !this.still) this.time += dt * (this.flow ?? 1) * (1 + 1.8 * energy + 0.8 * bass);
    this.pulse.retarget(1 + 0.09 * (reactor?.bass || 0) * (this.pulseAmount ?? 1) + 0.025 * energy);
    this.pulse.step(dt);
    const p = this.pulse.value;
    if (Math.abs(p - this.lastPulse) > 0.0003) {
      this.lastPulse = p;
      this.canvas.style.transform = p === 1 ? '' : `scale(${p.toFixed(4)})`;
    }
    const lift = Math.round((0.6 * energy + 0.4 * bass) * 100) / 100;
    if (lift !== this.lastLift) {
      this.lastLift = lift;
      this.container.style.setProperty('--lift', lift);
    }
    if (this.fade < 1) { this.fade = Math.min(1, this.fade + dt / 0.8); this.dirty = true; }
    this.acc += dt;
    if (((playing && !this.still) || this.dirty) && this.acc >= 1 / FPS - 0.002) {
      this.acc = 0;
      this.dirty = false;
      this.draw();
    }
  }

  drawScene(img, alpha) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const diag = Math.hypot(W, H);
    for (const L of LAYERS) {
      const t = this.time;
      const size = diag * L.size;
      const a = (t / L.orbitPeriod) * Math.PI * 2 + L.phase;
      const cx = W / 2 + Math.cos(a) * L.orbit * W;
      const cy = H / 2 + Math.sin(a) * L.orbit * H;
      ctx.save();
      ctx.globalAlpha = alpha * L.alpha;
      ctx.translate(cx, cy);
      ctx.rotate((t / L.spin) * Math.PI * 2 + L.phase);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }

  draw() {
    const { ctx, canvas } = this;
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#2a3442';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.hasFilter) ctx.filter = `blur(${(BLUR_CSS_PX * SCALE).toFixed(1)}px) saturate(${(1.4 + 0.5 * this.energy).toFixed(2)})`;
    if (this.previous && this.fade < 1) this.drawScene(this.previous, 1);
    this.drawScene(this.current, this.fade);
    if (this.fade >= 1) this.previous = null;
    ctx.filter = 'none';
  }
}
