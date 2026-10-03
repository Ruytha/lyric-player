// AMLL's mesh-gradient background (the one in AMLL Player), driven by our
// bass analyser. Same interface as ArtworkBackground: setImage / update.

import { BackgroundRender, MeshGradientRenderer } from './vendor/amll-lyrics.js';
import { Spring } from './spring.js';

function placeholderUrl() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 64);
  grad.addColorStop(0, '#56677f');
  grad.addColorStop(0.5, '#3a4659');
  grad.addColorStop(1, '#262d3a');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c.toDataURL();
}

export class AmllBackground {
  /** Throws if WebGL isn't available; callers fall back to ArtworkBackground. */
  constructor(container) {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('WebGL unavailable');
    this.container = container;
    this.bg = BackgroundRender.new(MeshGradientRenderer);
    this.canvas = this.bg.getElement();
    this.canvas.classList.add('amll-bg');
    container.prepend(this.canvas);
    this.bg.setHasLyric(true);
    this.pulse = new Spring({ stiffness: 320, damping: 18, mass: 1, value: 1, precision: 0.0002 });
    this.lastPulse = 1;
    this.lastLift = -1;
    this.react = 0.6;
    this.pulseAmount = 0.5;
    this.flow = 1;
    this.lastFlow = -1;
    this.src = undefined;
    this.setImage(null);
  }

  setActive(on) {
    this.canvas.hidden = !on;
    if (on) this.bg.resume(); else this.bg.pause();
  }

  async setImage(src) {
    this.src = src;
    try {
      await this.bg.setAlbum(src || placeholderUrl());
    } catch {
      if (this.src === src) await this.bg.setAlbum(placeholderUrl()).catch(() => {});
    }
  }

  apply(s) {
    this.react = s.bgReact;
    this.pulseAmount = s.bgPulse;
    this.flow = s.bgFlow;
    this.bg.setRenderScale(s.bgScale);
    this.bg.setFPS(s.bgFps);
    this.bg.setStaticMode(s.bgStatic);
  }

  update(dt, playing, reactor = null) {
    const bass = (reactor?.bass || 0) * this.react;
    const energy = (reactor?.energy || 0) * this.react;
    // AMLL feeds its own "low frequency volume" (~0–1); the mesh warps with it.
    this.bg.setLowFreqVolume(Math.min(1.5, bass * 1.5));
    // Flow faster while the song is loud, and stop drifting when paused.
    const flow = playing ? this.flow * (1 + 1.2 * energy) : this.flow * 0.25;
    if (Math.abs(flow - this.lastFlow) > 0.01) { this.lastFlow = flow; this.bg.setFlowSpeed(flow); }

    this.pulse.retarget(1 + 0.09 * (reactor?.bass || 0) * this.pulseAmount);
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
  }
}
