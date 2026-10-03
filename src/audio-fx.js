// Sound for your own songs (not for music followed from other apps):
//  - Karaoke: turns the lead vocal down. Vocals are usually mixed in the
//    centre, so the left−right difference keeps the instruments and drops the
//    voice; the bass (also centred) is put back from a low-passed mix.
//  - Volume levelling: measures how loud the song is over the last few
//    seconds and turns quiet songs up / loud ones down (±9 dB).
//  - Equalizer: 10 bands, ±12 dB.
//  - Crossfade and AutoMix: the end of a song keeps playing on a second
//    player (the "tail") while the next one comes in on the main player.
//
//   element → [dry | karaoke] → level → mix filter → fade ─┐
//   tail    → tail gain → tail filter ─────────────────────┴→ bus → EQ → limiter → out
//
// AudioReactor's analyser (and the speakers) sit after `out`.

const LEVEL_TARGET = -18;   // dB RMS
const LEVEL_RANGE = [-9, 9];
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const db = (x) => 20 * Math.log10(Math.max(1e-6, x));
const fromDb = (d) => 10 ** (d / 20);
const OPEN = 10; // Hz: a high-pass this low lets everything through

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.karaoke = false;
    this.level = false;
    this.eq = { on: false, gains: EQ_BANDS.map(() => 0) };
    this.loud = null;   // running loudness estimate (dB)
    this.tail = null;   // the outgoing song during a crossfade / AutoMix
  }

  /** Called by AudioReactor once it has an AudioContext; returns the node to analyse. */
  build(ctx, source) {
    this.ctx = ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const filter = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; return n; };
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
    const hp = filter('highpass', 140);
    side.connect(hp);
    const bassMix = g(0.5);
    split.connect(bassMix, 0);
    split.connect(bassMix, 1);
    const lp1 = filter('lowpass', 140), lp2 = filter('lowpass', 140);
    bassMix.connect(lp1); lp1.connect(lp2);
    const merge = ctx.createChannelMerger(2);
    for (const ch of [0, 1]) { hp.connect(merge, 0, ch); lp2.connect(merge, 0, ch); }
    merge.connect(this.wet);

    // Levelling: measure the song itself, then a slow gain.
    this.levelGain = g(1);
    this.dry.connect(this.levelGain);
    this.wet.connect(this.levelGain);
    this.meterIn = ctx.createAnalyser();
    this.meterIn.fftSize = 2048;
    this.input.connect(this.meterIn);
    this.buf = new Float32Array(this.meterIn.fftSize);

    // Mix filter (AutoMix holds the incoming song's bass back) and fade.
    this.mixFilter = filter('highpass', OPEN, 0.7);
    this.levelGain.connect(this.mixFilter);
    this.fade = g(1);
    this.mixFilter.connect(this.fade);

    // Bus → EQ → limiter → out
    this.bus = g(1);
    this.fade.connect(this.bus);
    this.eqNodes = EQ_BANDS.map((f, i) => filter(i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking', f, 1.1));
    let node = this.bus;
    for (const n of this.eqNodes) { node.connect(n); node = n; }
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    node.connect(this.limiter);
    this.out = g(1);
    this.limiter.connect(this.out);
    this.applyEq();
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

  /** gains: 10 numbers in dB. */
  setEq(on, gains) {
    this.eq = { on: !!on, gains: EQ_BANDS.map((_, i) => Math.max(-12, Math.min(12, Number(gains?.[i]) || 0))) };
    this.applyEq();
  }

  applyEq() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.eqNodes.forEach((n, i) => n.gain.setTargetAtTime(this.eq.on ? this.eq.gains[i] : 0, t, 0.05));
    // Boosting can push past full scale: take the biggest boost back off.
    const boost = this.eq.on ? Math.max(0, ...this.eq.gains) : 0;
    this.bus.gain.setTargetAtTime(fromDb(-boost * 0.35), t, 0.05);
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
    if (this.loud == null) this.loudFrames = 0;
    // Fast at the start of a song, then a slow running average (~6 s).
    const k = this.loud == null ? 1 : Math.min(1, dt / (this.loudFrames++ < 120 ? 0.8 : 6));
    this.loud = this.loud == null ? rms : this.loud + (rms - this.loud) * k;
    const want = Math.min(LEVEL_RANGE[1], Math.max(LEVEL_RANGE[0], LEVEL_TARGET - this.loud));
    this.levelGain.gain.setTargetAtTime(fromDb(want), this.ctx.currentTime, 0.5);
  }

  /** Fades the main player to `to` (0..1) over `secs`. */
  fadeTo(to, secs) {
    if (!this.ctx) return;
    const p = this.fade.gain, t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(to, t + Math.max(0.01, secs));
  }

  /**
   * Hands the playing song over to a second player without a gap: the tail
   * starts silent, lines up with the main player (mainTime()), then the two
   * swap in 40 ms. Resolves once the main player is silent and free.
   * onEnd() runs when the tail has finished.
   */
  async startTail(url, mainTime, onEnd) {
    if (!this.ctx) return false;
    this.stopTail();
    const ctx = this.ctx;
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = url;
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass'; hpf.frequency.value = OPEN; hpf.Q.value = 0.7;
    src.connect(gain); gain.connect(hpf); hpf.connect(this.bus);
    const tail = this.tail = { el, url, gain, hpf, done: false };
    tail.finish = () => {
      if (tail.done) return;
      tail.done = true;
      clearTimeout(tail.timer);
      el.pause(); el.removeAttribute('src'); el.load();
      try { src.disconnect(); gain.disconnect(); hpf.disconnect(); } catch { /* already gone */ }
      if (this.tail === tail) this.tail = null;
      onEnd?.();
    };
    el.addEventListener('ended', tail.finish, { once: true });
    const wait = (ev, ms) => new Promise((r) => { const t = setTimeout(r, ms); el.addEventListener(ev, () => { clearTimeout(t); r(); }, { once: true }); });
    el.currentTime = mainTime() + 0.25;
    try { await el.play(); } catch { tail.finish(); return false; }
    await wait('playing', 1500);
    // Line up with the main player, then swap.
    el.currentTime = mainTime() + 0.03;
    await wait('seeked', 800);
    await new Promise((r) => setTimeout(r, 30));
    if (tail.done) return false;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + 0.04);
    this.fadeTo(0, 0.04);
    await new Promise((r) => setTimeout(r, 60));
    return true;
  }

  /** Fades the tail out over `secs`; with bassSwap, its bass goes halfway through. */
  tailOut(secs, { bassSwap = false } = {}) {
    const tail = this.tail;
    if (!tail) return;
    const t = this.ctx.currentTime;
    tail.gain.gain.cancelScheduledValues(t);
    tail.gain.gain.setValueAtTime(tail.gain.gain.value, t);
    if (bassSwap) {
      // Full level for the first half, then down; the bass leaves at the middle.
      tail.gain.gain.setValueAtTime(1, t + secs * 0.45);
      tail.gain.gain.linearRampToValueAtTime(0, t + secs);
      tail.hpf.frequency.setValueAtTime(OPEN, t + secs * 0.45);
      tail.hpf.frequency.exponentialRampToValueAtTime(260, t + secs * 0.55);
    } else {
      tail.gain.gain.linearRampToValueAtTime(0, t + secs);
    }
    tail.timer = setTimeout(tail.finish, secs * 1000 + 200);
  }

  /** Fades the main player in over `secs`; with bassSwap, its bass arrives halfway through. */
  mainIn(secs, { bassSwap = false } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = this.mixFilter.frequency;
    f.cancelScheduledValues(t);
    if (bassSwap) {
      f.setValueAtTime(260, t);
      f.setValueAtTime(260, t + secs * 0.45);
      f.exponentialRampToValueAtTime(OPEN, t + secs * 0.55);
      const p = this.fade.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(1, t + secs * 0.5);
    } else {
      f.setValueAtTime(OPEN, t);
      this.fadeTo(1, secs);
    }
  }

  stopTail() { this.tail?.finish(); }
  tailUses(url) { return this.tail?.url === url && !this.tail.done; }
}
