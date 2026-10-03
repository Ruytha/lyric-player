// Listens to the <audio> element through Web Audio and reports how hard the
// music is hitting, so the background can breathe with it.
//
// `bass` follows the kick/low end (fast attack, slower release) and `energy`
// the overall loudness. Both are normalised against a running floor/peak so
// quiet and loud masters react about the same.
//
// Caveat: routing an element through createMediaElementSource is permanent,
// and a cross-origin source without CORS would come out silent. So we only
// attach when the current source is a blob:/data:/same-origin URL.

const BASS_HZ = [30, 150];
const ATTACK = 0.035;   // s
const RELEASE = 0.28;   // s

// Music-folder songs (desktop app) come from media://, which sends CORS
// headers, so they can be analysed when loaded with crossorigin="anonymous".
const corsMedia = (src) => /^media:/i.test(src || '');

function sameOrigin(src) {
  if (!src) return false;
  if (/^(blob|data):/i.test(src)) return true;
  try { return new URL(src, location.href).origin === location.origin; } catch { return false; }
}

export class AudioReactor {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.analyser = null;
    this.bins = null;
    this.enabled = true;
    this.bass = 0;
    this.energy = 0;
    this.stats = null; // running floor/peak, seeded from the first frames
    this.fx = null;    // AudioFx, set by the page
    audio.addEventListener('play', () => this.attach());
  }

  /** True once audio is flowing through the analyser. */
  get live() { return !!this.analyser && this.ctx.state === 'running'; }

  attach() {
    if (!this.enabled) return;
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    const src = this.audio.currentSrc || this.audio.src;
    if (!AC || !(sameOrigin(src) || (corsMedia(src) && this.audio.crossOrigin === 'anonymous'))) return;
    try {
      this.ctx = new AC();
      const src = this.ctx.createMediaElementSource(this.audio);
      const an = this.ctx.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0.5;
      an.minDecibels = -90;
      an.maxDecibels = -15;
      // Effects (karaoke, levelling, crossfade) sit before the analyser.
      (this.fx ? this.fx.build(this.ctx, src) : src).connect(an);
      an.connect(this.ctx.destination);
      this.analyser = an;
      this.bins = new Uint8Array(an.frequencyBinCount);
      this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
      this.analyser = null;
    }
  }

  /** Call before loading a new source once attached, so cross-origin URLs are fetched with CORS. */
  prepareSource(src) {
    if (corsMedia(src)) { this.audio.crossOrigin = 'anonymous'; return; }
    if (!this.ctx) return;
    if (sameOrigin(src)) this.audio.removeAttribute('crossorigin');
    else this.audio.crossOrigin = 'anonymous';
  }

  update(dt, playing) {
    let bassIn = 0, allIn = 0;
    if (this.enabled && playing && this.live) {
      const an = this.analyser, b = this.bins;
      an.getByteFrequencyData(b);
      const hz = this.ctx.sampleRate / an.fftSize;
      const lo = Math.max(1, Math.floor(BASS_HZ[0] / hz)), hi = Math.ceil(BASS_HZ[1] / hz);
      let sb = 0;
      for (let i = lo; i <= hi; i++) sb += b[i];
      const bass = sb / (hi - lo + 1) / 255;
      const top = Math.min(b.length, Math.ceil(8000 / hz));
      let sa = 0;
      for (let i = 1; i < top; i++) sa += b[i];
      const all = sa / (top - 1) / 255;

      const s = this.stats ??= { bassFloor: bass * 0.7, bassPeak: bass + 0.1, allFloor: all * 0.7, allPeak: all + 0.08 };
      // Floor drifts up slowly and drops fast; peak jumps up and decays slowly.
      const follow = (v, x, up, down) => v + (x - v) * (1 - Math.exp(-dt / (x > v ? up : down)));
      s.bassFloor = follow(s.bassFloor, bass, 4, 0.5);
      s.bassPeak = Math.max(follow(s.bassPeak, bass, 0.02, 6), s.bassFloor + 0.08);
      s.allFloor = follow(s.allFloor, all, 4, 0.5);
      s.allPeak = Math.max(follow(s.allPeak, all, 0.05, 5), s.allFloor + 0.05);
      const norm = (x, f, p) => Math.min(1, Math.max(0, (x - f) / (p - f)));
      bassIn = norm(bass, s.bassFloor, s.bassPeak) ** 1.6; // favour real hits over rumble
      allIn = norm(all, s.allFloor * 0.6, s.allPeak);
    }
    const env = (v, x) => v + (x - v) * (1 - Math.exp(-dt / (x > v ? ATTACK : RELEASE)));
    this.bass = env(this.bass, bassIn);
    this.energy = env(this.energy, allIn * 0.8 + bassIn * 0.2);
  }
}
