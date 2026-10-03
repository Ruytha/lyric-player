// Lyrics view powered by AMLL's own lyric player (the engine inside AMLL
// Player / AMLL Tool), so line scaling, springs, word sweep, held-word swell
// and interlude dots behave exactly like it.
//
// Timed lyrics (word or line timing) go to AMLL. Untimed lyrics and the
// "drop a .ttml" messages still use our own LyricsRenderer.
//
// AMLL core is AGPL-3.0-only; see src/vendor/amll-lyrics.js and LICENSE.

import { DomLyricPlayer } from './vendor/amll-lyrics.js';
import { LyricsRenderer } from './renderer.js';
import { toAmllLines } from './amll-convert.js';

const ms = (s) => Math.round(s * 1000);

export class AmllLyricsRenderer {
  constructor(panel, { onSeek } = {}) {
    this.panel = panel;
    this.onSeek = onSeek;
    // Fallback for untimed lyrics and messages.
    this.legacy = new LyricsRenderer(panel, { onSeek });
    this.player = new DomLyricPlayer();
    this.el = this.player.getElement();
    this.el.classList.add('amll-host');
    this.el.hidden = true;
    panel.appendChild(this.el);
    this.model = null;
    this.useAmll = false;
    this.showTranslation = false;
    this.showRoman = true;
    this.fontKey = '';
    this.relayoutTimer = 0;
    this.playing = null;
    this.lastT = null;

    // A heavier/lighter weight or a web font finishing to load changes line
    // heights; let AMLL re-measure.
    document.fonts?.addEventListener?.('loadingdone', () => this.remeasure());

    this.player.addEventListener('line-click', (evt) => {
      const line = evt.line?.getLine?.();
      if (line && Number.isFinite(line.startTime)) this.onSeek?.(line.startTime / 1000);
    });
  }

  setLyrics(model, emptyMessage) {
    const timed = !!model && model.lines.length > 0 && model.timing !== 'none';
    this.model = timed ? model : null;
    this.useAmll = timed;
    this.el.hidden = !timed;
    this.panel.classList.toggle('amll', timed);
    this.legacy.setLyrics(timed ? null : model, timed ? '' : emptyMessage);
    if (timed) {
      this.player.setLyricLines(this.lines(), ms(this.lastT ?? 0));
    } else {
      this.player.setLyricLines([]);
    }
  }

  lines() {
    return toAmllLines(this.model, { translation: this.showTranslation, romanization: this.showRoman });
  }

  setTranslationVisible(on, roman = this.showRoman) {
    if (on === this.showTranslation && roman === this.showRoman) return;
    this.showTranslation = on;
    this.showRoman = roman;
    this.legacy.setTranslationVisible(on);
    if (this.useAmll && this.model) this.player.setLyricLines(this.lines(), ms(this.lastT ?? 0));
  }

  /** Lyric settings from settings.js. */
  apply(s) {
    const p = this.player;
    p.setWordFadeWidth(s.wordFade);
    p.setAlignAnchor(s.alignAnchor || 'center');
    p.setAlignPosition(s.alignPosition);
    p.setEnableBlur(s.lineBlur);
    p.setEnableScale(s.lineScale);
    p.setEnableSpring(s.springs);
    p.setHidePassedLines(s.hidePassed);
    this.setTranslationVisible(s.translation, s.romanization);

    const st = this.panel.style;
    st.setProperty('--lyric-scale', s.lyricSize);
    st.setProperty('--lyric-weight', s.lyricWeight);
    st.setProperty('--lyric-spacing', `${s.letterSpacing}em`);
    // Bloom: a soft glow around the lit part of the line being sung.
    st.setProperty('--bloom-r', `${(0.05 + 0.3 * s.bloom).toFixed(3)}em`);
    st.setProperty('--bloom-a', (0.85 * s.bloom).toFixed(3));
    this.panel.classList.toggle('bloom', s.bloom > 0.005);

    // Text metrics changed: let both renderers re-measure once things settle.
    const fontKey = `${s.lyricSize}|${s.lyricWeight}|${s.letterSpacing}`;
    if (fontKey !== this.fontKey) {
      const first = !this.fontKey;
      this.fontKey = fontKey;
      if (!first) {
        this.remeasure();
      }
    }
  }

  remeasure() {
    clearTimeout(this.relayoutTimer);
    this.relayoutTimer = setTimeout(() => {
      this.legacy.needsLayout = true;
      if (!this.useAmll) return;
      this.player.onResize();
      this.player.rebuildLyricView(ms(this.lastT ?? 0));
    }, 120);
  }

  /** t: lyric time (s), dt: frame time (s), playing: whether audio is running. */
  update(t, dt, playing = true) {
    if (!this.useAmll) { this.legacy.update(t, dt); return; }
    if (playing !== this.playing) {
      this.playing = playing;
      if (playing) this.player.resume(); else this.player.pause();
    }
    const jumped = this.lastT != null && (t < this.lastT - 0.05 || t - this.lastT > 1.0);
    this.lastT = t;
    this.player.setCurrentTime(ms(t), jumped);
    this.player.update(dt * 1000);
  }

  // Kept for the console handle / older debugging snippets.
  get lineItems() { return this.legacy.lineItems; }
}
