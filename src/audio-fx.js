// Sound for your own songs (not for music followed from other apps):
//  - Karaoke: turns the lead vocal down. Vocals are usually mixed in the
//    centre, so the left−right difference keeps the instruments and drops the
//    voice; the bass (also centred) is put back from a low-passed mix.
//  - Volume levelling: measures how loud the song is over the last few
//    seconds and turns quiet songs up / loud ones down (±9 dB), with a limiter
//    so nothing clips.
//  - Crossfade: the end of a song fades out on a second player while the next
//    one fades in.
//
// The graph sits between the <audio> element and AudioReactor's analyser:
//   element → [dry | karaoke] → level gain → limiter → fade → out

const LEVEL_TARGET = -18;   // dB RMS
const LEVEL_RANGE = [-9, 9];

const db = (x) => 20 * Math.log10(Math.max(1e-6, x));
const fromDb = (d) => 10 ** (d / 20);

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.karaoke = false;
    this.level = false;
    this.crossfade = 0;
    this.loud = null;   // running loudness estimate (dB)
    this.tail = null;   // the fading-out player during a crossfade
  }

  /** Called by AudioReactor once it has an AudioContext; returns the node to analyse. */
  build(ctx, source) {
    this.ctx = ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.input = g();
    source.connect(this.input);

    // Dry path
    this.dry = g(this.karaoke ? 0 : 1);
    this.input.connect(this.dry);

    // Karaoke path: (L − R) on both sides, plus low-passed (L + R) / 2.
    this.wet = g(this.karaoke ? 1 : 0);
    const split = ctx.createChannelSplitter(2);
    this.input.connect(split);
    const side = g(1), minusR = g(-1);
    split.connect(side, 0);
    split.connect(minusR, 1);
    minusR.connect(side);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    side.connect(hp);
    const bassMix = g(0.5);
    split.connect(bassMix, 0);
    split.connect(bassMix, 1);
    const lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 140;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 140;
    bassMix.connect(lp1); lp1.connect(lp2);
    const merge = ctx.createChannelMerger(2);
    for (const ch of [0, 1]) { hp.connect(merge, 0, ch); lp2.connect(merge, 0, ch); }
    merge.connect(this.wet);

    // Levelling: measure, then a slow gain and a limiter.
    this.levelGain = g(1);
    this.dry.connect(this.levelGain);
    this.wet.connect(this.levelGain);
    this.meterIn = ctx.createAnalyser(); // loudness of the song itself
    this.meterIn.fftSize = 2048;
    this.input.connect(this.meterIn);
    this.buf = new Float32Array(this.meterIn.fftSize);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.levelGain.connect(this.limiter);

    // Fade in / out (crossfade, sleep timer)
    this.fade = g(1);
    this.limiter.connect(this.fade);
    this.out = g(1);
    this.fade.connect(this.out);
    return this.out;
  }

  get ready() { return !!this.ctx; }

  setKaraoke(on) {
    this.karaoke = !!on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(on ? 0 : 1, t, 0.08);
    this.wet.gain.setTargetAtTime(on ? 1 : 0, t, 0.08);
  }

  setLevel(on) {
    this.level = !!on;
    if (this.ctx && !on) this.levelGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
  }

  /** A new song: measure it afresh. */
  newSong() { this.loud = null; }

  /** Each frame while playing. */
  update(dt, playing) {
    if (!this.ctx || !this.level || !playing) return;
    this.meterIn.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = db(Math.sqrt(sum / this.buf.length));
    if (rms < -55) return; // silence between songs or in breaks
    // Fast at the start of a song, then a slow running average (~6 s).
    const k = this.loud == null ? 1 : Math.min(1, dt / (this.loudFrames++ < 120 ? 0.8 : 6));
    if (this.loud == null) this.loudFrames = 0;
    this.loud = this.loud == null ? rms : this.loud + (rms - this.loud) * k;
    const want = Math.min(LEVEL_RANGE[1], Math.max(LEVEL_RANGE[0], LEVEL_TARGET - this.loud));
    this.levelGain.gain.setTargetAtTime(fromDb(want), this.ctx.currentTime, 0.5);
  }

  /** Fades the main output to `to` (0..1) over `secs`. */
  fadeTo(to, secs) {
    if (!this.ctx) return;
    const p = this.fade.gain, t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(to, t + Math.max(0.01, secs));
  }

  /**
   * Crossfade: keeps playing `url` from `time` on a second player, fading it
   * out over `secs`, while the main player moves on. Calls done() after.
   */
  startTail(url, time, secs, done) {
    if (!this.ctx) { done?.(); return false; }
    this.stopTail();
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.src = url;
    el.currentTime = time;
    const src = this.ctx.createMediaElementSource(el);
    const gain = this.ctx.createGain();
    src.connect(gain);
    gain.connect(this.out); // after the main fade, which fades the next song in
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(1, t);
    gain.gain.linearRampToValueAtTime(0, t + secs);
    const finish = () => {
      if (this.tail?.el !== el) return;
      el.pause(); el.removeAttribute('src'); el.load();
      try { src.disconnect(); gain.disconnect(); } catch { /* already gone */ }
      this.tail = null;
      done?.();
    };
    this.tail = { el, url, timer: setTimeout(finish, secs * 1000 + 150), finish };
    el.addEventListener('ended', finish, { once: true });
    el.play().catch(finish);
    return true;
  }

  stopTail() { if (this.tail) { clearTimeout(this.tail.timer); this.tail.finish(); } }
  tailUses(url) { return this.tail?.url === url; }
}
