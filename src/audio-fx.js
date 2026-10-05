// Sound for your own songs (not for music followed from other apps):
//  - Karaoke: turns the lead vocal down. Vocals are usually mixed in the
//    centre, so the sound is split into centre (L+R) and sides (L−R), and the
//    voice's range (180 Hz–7 kHz) is taken out of the centre only. Bass, kick,
//    cymbals and everything panned left or right stay, in stereo. The bands
//    are split with Linkwitz–Riley filters, so they add back up flat. Part of
//    the voice can be kept as a guide (karaokeVoice).
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
const VOICE_LOW = 180, VOICE_HIGH = 7000; // Hz: the range Karaoke takes out of the centre
const MONO_DB = -32; // sides this far under the centre: a mono song, Karaoke can't separate the voice

/** Karaoke: the sides' voice-band gain for a kept voice share v (+3 dB at v = 0, flat at v = 1). */
const sideLift = (v) => 1 + (1 - v) * (Math.SQRT2 - 1);

function rms(analyser, buf) {
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return db(Math.sqrt(sum / buf.length));
}

export class AudioFx {
  constructor() {
    this.ctx = null;
    this.karaoke = false;
    this.voice = 0;     // Karaoke: how much of the voice is kept (0..1)
    this.onMono = null; // called once per song when Karaoke can't work (a mono song)
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

    // Karaoke path. Centre M = (L+R)/2 and sides S = (L−R)/2, each split into
    // low / voice / high bands; the centre's voice band is turned down, the
    // sides go through the same filters (so both stay in phase), then
    // L = M' + S', R = M' − S'.
    this.wet = g(this.karaoke ? 1 : 0);
    const split = ctx.createChannelSplitter(2);
    this.input.connect(split);
    const mid = g(0.5), side = g(0.5), minusR = g(-1);
    split.connect(mid, 0); split.connect(mid, 1);
    split.connect(side, 0); split.connect(minusR, 1); minusR.connect(side);
    // Linkwitz–Riley (two Butterworth stages): low + high add back up flat.
    // Web Audio reads a low/high-pass Q in dB: Butterworth's 0.707 is −3.01 dB.
    const BUTTERWORTH = 20 * Math.log10(Math.SQRT1_2);
    const lr4 = (from, type, f) => {
      const a = filter(type, f, BUTTERWORTH), b = filter(type, f, BUTTERWORTH);
      from.connect(a); a.connect(b);
      return b;
    };
    const bands = (from) => {
      const rest = lr4(from, 'highpass', VOICE_LOW);
      return { low: lr4(from, 'lowpass', VOICE_LOW), voice: lr4(rest, 'lowpass', VOICE_HIGH), high: lr4(rest, 'highpass', VOICE_HIGH) };
    };
    const m = bands(mid), s = bands(side);
    const centre = g(1), sides = g(1);
    this.voiceGain = g(this.voice);
    m.low.connect(centre); m.high.connect(centre); m.voice.connect(this.voiceGain); this.voiceGain.connect(centre);
    // A sound panned to one side loses half of itself with the centre's voice
    // band; the sides' voice band makes up 3 dB of that (none when the voice stays).
    this.sideVoiceGain = g(sideLift(this.voice));
    s.low.connect(sides); s.voice.connect(this.sideVoiceGain); this.sideVoiceGain.connect(sides); s.high.connect(sides);
    const merge = ctx.createChannelMerger(2), minusS = g(-1);
    centre.connect(merge, 0, 0); centre.connect(merge, 0, 1);
    sides.connect(merge, 0, 0); sides.connect(minusS); minusS.connect(merge, 0, 1);
    merge.connect(this.wet);
    // Meters for spotting mono songs (no sides to work with).
    this.meterMid = ctx.createAnalyser(); this.meterMid.fftSize = 1024;
    this.meterSide = ctx.createAnalyser(); this.meterSide.fftSize = 1024;
    mid.connect(this.meterMid); side.connect(this.meterSide);
    this.monoBuf = new Float32Array(1024);
    this.monoSecs = 0;

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

  /** How much of the voice Karaoke keeps, 0 (none) to 1 (all of it). */
  setKaraokeVoice(v) {
    this.voice = Math.max(0, Math.min(1, Number(v) || 0));
    if (!this.ctx) return;
    this.voiceGain.gain.setTargetAtTime(this.voice, this.ctx.currentTime, 0.08);
    this.sideVoiceGain.gain.setTargetAtTime(sideLift(this.voice), this.ctx.currentTime, 0.08);
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
  newSong() { this.loud = null; this.monoSecs = 0; this.monoTold = false; }

  /** Each frame while playing. */
  update(dt, playing) {
    if (!this.ctx || !playing) return;
    if (this.karaoke) this.checkMono(dt);
    if (!this.level) return;
    const now = rms(this.meterIn, this.buf);
    if (now < -55) return; // silence between songs or in breaks
    if (this.loud == null) this.loudFrames = 0;
    // Fast at the start of a song, then a slow running average (~6 s).
    const k = this.loud == null ? 1 : Math.min(1, dt / (this.loudFrames++ < 120 ? 0.8 : 6));
    this.loud = this.loud == null ? now : this.loud + (now - this.loud) * k;
    const want = Math.min(LEVEL_RANGE[1], Math.max(LEVEL_RANGE[0], LEVEL_TARGET - this.loud));
    this.levelGain.gain.setTargetAtTime(fromDb(want), this.ctx.currentTime, 0.5);
  }

  /** Karaoke needs stereo: tells onMono() once per song when the sides stay silent for 3 s of music. */
  checkMono(dt) {
    if (this.monoTold) return;
    const centre = rms(this.meterMid, this.monoBuf);
    if (centre < -45) return; // quiet parts don't count
    const sides = rms(this.meterSide, this.monoBuf);
    this.monoSecs = sides - centre < MONO_DB ? this.monoSecs + dt : 0;
    if (this.monoSecs > 3) { this.monoTold = true; this.onMono?.(); }
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
