// Left panel: artwork, title/artist, progress bar, transport, overflow menu.

import { Spring } from './spring.js';

export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const LONG_PRESS_MS = 450;
const REPEAT_MS = 350;

export class PlayerUI {
  /**
   * @param {HTMLAudioElement} audio
   * @param {{ onSeek(t:number):void, onTogglePlay():void, onMenuAction(action:string):void,
   *           onToggleLyrics():void }} handlers
   */
  constructor(audio, handlers) {
    this.audio = audio;
    this.handlers = handlers;
    const $ = (id) => document.getElementById(id);
    this.el = {
      art: $('art'), artImg: $('artImg'), title: $('title'), artist: $('artist'),
      fav: $('favBtn'), menuBtn: $('menuBtn'), menu: $('menu'), offsetVal: $('offsetVal'), transItem: $('transItem'),
      progress: $('progress'), fill: $('fill'), elapsed: $('elapsed'), remaining: $('remaining'),
      play: $('playBtn'), prev: $('prevBtn'), next: $('nextBtn'),
      volume: $('volume'), volFill: $('volFill'), badge: $('badge'),
      lyricsBtn: $('lyricsBtn'), airplayBtn: $('airplayBtn'), queueBtn: $('queueBtn'),
    };
    this.artSpring = new Spring({ stiffness: 260, damping: 20, value: 0.9, precision: 0.0005 });
    this.artWritten = null;
    this.drag = null;
    this.lastSecond = null;
    this.lastFill = -1;
    this.wasPlaying = null;
    this.getDuration = () => audio.duration; // replaced while following another app

    this.bindTransport();
    this.bindProgress();
    this.bindPopover(this.el.menuBtn, this.el.menu, (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return false;
      this.handlers.onMenuAction(btn.dataset.action);
      // Offset buttons keep the menu open so they can be clicked repeatedly.
      return !btn.dataset.action.startsWith('offset');
    });
    this.bindVolume();
    this.bindBottomRow();
    for (const m of [this.el.title, this.el.artist]) this.bindMarquee(m);
  }

  // -------------------------------------------------------------------------

  setMeta({ title, artist }) {
    this.el.title.firstElementChild.textContent = title;
    this.el.artist.firstElementChild.textContent = artist;
    this.el.title.title = title;
    this.el.artist.title = artist;
    document.title = `${title} — ${artist}`;
  }

  setArtwork(url) {
    const img = this.el.artImg;
    if (url) { img.src = url; img.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; }
  }

  setOffsetLabel(ms) {
    this.el.offsetVal.textContent = `${ms > 0 ? '+' : ''}${ms} ms`;
  }

  /** Small format badge between the times, like Apple Music's "Lossless". */
  setBadge(text) {
    this.el.badge.textContent = text || '';
    this.el.badge.hidden = !text;
  }

  setLyricsShown(on) {
    this.el.lyricsBtn.setAttribute('aria-pressed', String(on));
  }

  setTranslation(available, on) {
    this.el.transItem.hidden = !available;
    this.el.transItem.textContent = on ? 'Hide translation' : 'Show translation';
  }

  // -------------------------------------------------------------------------

  bindTransport() {
    const { play, prev, next, fav } = this.el;
    play.addEventListener('click', () => this.handlers.onTogglePlay());
    for (const b of [fav].filter(Boolean)) {
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        b.setAttribute('aria-pressed', String(on));
      });
    }
    // previous: tap = previous song (or restart), hold = −10 s (repeating)
    this.bindHold(prev, () => this.handlers.onPrev(), () => this.handlers.onSeek(this.audio.currentTime - 10));
    // next: tap = next song, hold = +10 s (repeating)
    this.bindHold(next, () => this.handlers.onNext(), () => this.handlers.onSeek(this.audio.currentTime + 10));
  }

  bindHold(btn, onTap, onHold) {
    let timer = null, fired = false, down = false;
    const stop = () => { clearTimeout(timer); clearInterval(timer); timer = null; down = false; };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      fired = false;
      down = true;
      timer = setTimeout(() => {
        fired = true;
        onHold();
        timer = setInterval(onHold, REPEAT_MS);
      }, LONG_PRESS_MS);
    });
    btn.addEventListener('pointerup', () => {
      if (!down) return;
      const wasHeld = fired;
      stop();
      if (!wasHeld) onTap();
    });
    btn.addEventListener('pointerleave', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onTap(); } });
  }

  bindProgress() {
    const bar = this.el.progress;
    const frac = (e) => {
      const r = bar.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !Number.isFinite(this.getDuration())) return;
      try { bar.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      bar.classList.add('dragging');
      this.drag = { id: e.pointerId, frac: frac(e) };
    });
    bar.addEventListener('pointermove', (e) => {
      if (this.drag?.id === e.pointerId) this.drag.frac = frac(e);
    });
    const end = (e) => {
      if (this.drag?.id !== e.pointerId) return;
      const f = this.drag.frac;
      this.drag = null;
      bar.classList.remove('dragging');
      if (e.type === 'pointerup') this.handlers.onSeek(f * this.getDuration());
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
  }

  /** Toggle a popover from its button; onClick returns true to close after a click inside. */
  bindPopover(btn, pop, onClick) {
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      for (const other of document.querySelectorAll('.menu')) other.hidden = true;
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onClick(e)) close();
    });
    document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target)) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }

  bindVolume() {
    const bar = this.el.volume;
    const set = (e) => {
      const r = bar.getBoundingClientRect();
      this.audio.volume = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    };
    let id = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      id = e.pointerId;
      try { bar.setPointerCapture(id); } catch { /* pointer already gone */ }
      bar.classList.add('dragging');
      set(e);
    });
    bar.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId === id) { id = null; bar.classList.remove('dragging'); } };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
      if (!step) return;
      e.preventDefault();
      e.stopPropagation();
      this.audio.volume = Math.min(1, Math.max(0, this.audio.volume + step));
    });
    const show = () => {
      const v = this.audio.muted ? 0 : this.audio.volume;
      this.el.volFill.style.transform = `scaleX(${v.toFixed(3)})`;
      bar.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    };
    this.audio.addEventListener('volumechange', show);
    show();
  }

  bindBottomRow() {
    const { lyricsBtn, airplayBtn } = this.el;
    lyricsBtn.addEventListener('click', () => this.handlers.onToggleLyrics());
    // AirPlay in Safari, Cast in Chrome — both via the Remote Playback API.
    const remote = this.audio.remote;
    if (remote && typeof remote.prompt === 'function') {
      airplayBtn.hidden = false;
      airplayBtn.addEventListener('click', () => {
        remote.prompt().catch((err) => {
          if (err.name !== 'AbortError') this.handlers.onNotice?.(`No playback devices found (${err.message})`);
        });
      });
      remote.addEventListener?.('connect', () => airplayBtn.setAttribute('aria-pressed', 'true'));
      remote.addEventListener?.('disconnect', () => airplayBtn.setAttribute('aria-pressed', 'false'));
    }
  }

  bindMarquee(el) {
    el.addEventListener('mouseenter', () => {
      const span = el.firstElementChild;
      const overflow = span.scrollWidth - el.clientWidth;
      if (overflow <= 2) return;
      el.style.setProperty('--shift', `${-overflow - 4}px`);
      el.style.setProperty('--marquee-dur', `${Math.max(3, overflow / 40 + 2)}s`);
      el.classList.add('scrolling');
    });
    el.addEventListener('mouseleave', () => el.classList.remove('scrolling'));
  }

  // -------------------------------------------------------------------------

  /** Per-frame: progress, times, artwork spring. */
  update(media, dt, playing) {
    const dur = this.getDuration();
    const shown = this.drag && Number.isFinite(dur) ? this.drag.frac * dur : media;
    const f = Number.isFinite(dur) && dur > 0 ? Math.min(1, shown / dur) : 0;
    if (Math.abs(f - this.lastFill) > 0.0002) {
      this.lastFill = f;
      this.el.fill.style.transform = `scaleX(${f.toFixed(5)})`;
    }
    const sec = Math.floor(shown);
    const durSec = Number.isFinite(dur) ? Math.floor(dur) : null;
    const key = `${sec}|${durSec}`;
    if (key !== this.lastSecond) {
      this.lastSecond = key;
      this.el.elapsed.textContent = formatTime(shown);
      this.el.remaining.textContent = durSec == null ? '--:--' : `-${formatTime(Math.max(0, dur - Math.floor(shown)))}`;
      this.el.progress.setAttribute('aria-valuenow', String(sec));
      this.el.progress.setAttribute('aria-valuemax', String(durSec ?? 0));
    }

    if (playing !== this.wasPlaying) {
      this.wasPlaying = playing;
      this.el.play.classList.toggle('playing', playing);
      this.el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      this.artSpring.setTarget(playing ? 1 : 0.9);
    }
    this.artSpring.step(dt);
    if (this.artSpring.value !== this.artWritten) {
      this.artWritten = this.artSpring.value;
      this.el.art.style.transform = `scale(${this.artWritten.toFixed(4)})`;
    }
  }
}
