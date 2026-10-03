// Sleep timer (••• → Sleep timer): stops the music after a while, or at the
// end of the song, with a gentle fade.

export const SLEEP_STEPS = [0, 15, 30, 45, 60, 'song'];
const FADE = 8; // s

export class SleepTimer {
  /** h: { stop(), fade(to, secs), remaining(): s left in the song, onChange(label) } */
  constructor(h) {
    this.h = h;
    this.mode = 0;      // minutes, 'song' or 0 (off)
    this.endsAt = 0;
    this.fading = false;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  get on() { return this.mode !== 0; }

  /** Off → 15 → 30 → 45 → 60 min → end of song → off. */
  cycle() {
    const i = SLEEP_STEPS.indexOf(this.mode);
    this.set(SLEEP_STEPS[(i + 1) % SLEEP_STEPS.length]);
  }

  set(mode) {
    this.cancelFade();
    this.mode = mode;
    this.endsAt = typeof mode === 'number' && mode > 0 ? Date.now() + mode * 60000 : 0;
    this.h.onChange(this.label());
  }

  label() {
    if (this.mode === 'song') return 'At the end of this song';
    if (!this.mode) return '';
    const left = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 60000));
    return left <= 1 ? 'Less than a minute left' : `${left} min left`;
  }

  left() {
    if (this.mode === 'song') return this.h.remaining();
    if (!this.mode) return Infinity;
    return (this.endsAt - Date.now()) / 1000;
  }

  tick() {
    if (!this.on) return;
    const left = this.left();
    if (left <= FADE && !this.fading && Number.isFinite(left)) {
      this.fading = true;
      this.h.fade(0, Math.max(0.5, left));
    }
    if (left <= 0.4) {
      this.h.stop();
      this.fading = false;
      this.mode = 0;
      setTimeout(() => this.h.fade(1, 0.05), 400);
    }
    this.h.onChange(this.label());
  }

  cancelFade() {
    if (this.fading) { this.fading = false; this.h.fade(1, 0.3); }
  }
}
