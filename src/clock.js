// Smooth playback clock.
//
// audio.currentTime advances in coarse, slightly irregular steps. Snapping to
// each new value (and freezing to hide backward steps) makes every animation
// that reads the clock stutter. Instead the clock runs on its own from frame
// time and is steered gently toward the audio: small drift is corrected over
// about a second, so it never steps or runs backwards. Big differences
// (seeks, stalls) still snap.

const SNAP = 0.25;      // s of drift beyond which we jump instead of steering
const STEER = 1.0;      // s time constant for drift correction
const NOISE = 0.3;      // s low-pass on the measured drift (currentTime is noisy)

export class PlaybackClock {
  constructor(audio) {
    this.audio = audio;
    this.offsetMs = 0;
    this.last = 0;
    this.lastNow = 0;
    this.playing = false;
    this.drift = 0;
    this.external = null; // { position(), playing, rate }: another app's playback (system-media.js)

    const snap = () => { this.last = audio.currentTime; };
    for (const ev of ['seeking', 'seeked', 'loadedmetadata', 'emptied']) audio.addEventListener(ev, snap);
    audio.addEventListener('pause', () => {
      // Stop where the smooth clock was, unless that's clearly wrong.
      if (Math.abs(audio.currentTime - this.last) > 0.15) this.last = audio.currentTime;
      this.playing = false;
    });
  }

  /** Call once per frame; returns media time in seconds (without offset). */
  tick(now = performance.now()) {
    const a = this.audio;
    const dt = this.lastNow ? Math.min(0.25, Math.max(0, (now - this.lastNow) / 1000)) : 0;
    this.lastNow = now;
    if (this.external) return this.tickExternal(dt);
    const playing = !a.paused && !a.ended && a.readyState >= 2 && !a.seeking;
    if (playing && !this.playing) { this.last = a.currentTime; this.drift = 0; }
    this.playing = playing;
    if (!playing) {
      if (a.seeking || a.ended || Math.abs(a.currentTime - this.last) > 0.15) this.last = a.currentTime;
      return this.last;
    }

    let t = this.last + dt * (a.playbackRate || 1);
    const err = a.currentTime - t;
    if (Math.abs(err) > SNAP) {
      this.last = a.currentTime;
      this.drift = 0;
    } else {
      this.drift += (err - this.drift) * (1 - Math.exp(-dt / NOISE));
      t += this.drift * (1 - Math.exp(-dt / STEER));
      // Never run backwards during normal playback.
      this.last = Math.max(this.last, t);
    }
    return this.last;
  }

  /** Same smoothing, following another app's (estimated) position. */
  tickExternal(dt) {
    const x = this.external;
    const target = x.position();
    const playing = x.playing;
    if (playing && !this.playing) this.drift = 0;
    this.playing = playing;
    if (!playing) { this.last = target; return this.last; }
    let t = this.last + dt * (x.rate || 1);
    const err = target - t;
    if (Math.abs(err) > SNAP * 2) { this.last = target; this.drift = 0; }
    else {
      this.drift += (err - this.drift) * (1 - Math.exp(-dt / NOISE));
      t += this.drift * (1 - Math.exp(-dt / STEER));
      this.last = Math.max(this.last, t);
    }
    return this.last;
  }

  /** Last ticked media time. */
  get media() { return this.last; }

  /** Lyric time: media time plus user offset. Positive offset = lyrics earlier. */
  get lyricTime() { return this.last + this.offsetMs / 1000; }
}
