// Sync editor: fix lyric timing by tapping along, or nudge lines by hand.
//
// Tap mode: play the song and press T (or the Tap button) as each line
// starts; that line moves to the moment you tapped, words and background
// vocals with it, and the next line is selected. Lines can also be nudged
// ±50 ms, set to "now", or everything shifted at once. Changes preview live;
// Save keeps them with the song, Export downloads the .ttml.

import { shiftParagraphs, formatTime } from './ttml-edit.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const REACTION = 0.06; // s: taps land a little after the line really starts

export class SyncEditor {
  /**
   * h: { getTtml() → { text, name, model }, time() → lyric time (s), togglePlay(), seek(t),
   *      preview(text), save(text), toast(msg) }
   */
  constructor(sheet, h) {
    this.sheet = sheet;
    this.h = h;
    this.list = sheet.querySelector('.sync-list');
    this.shifts = new Map();
    this.target = 0;
    this.lines = [];
    this.original = null;
    this.previewTimer = 0;
    this.currentRow = -1;

    sheet.querySelector('[data-close]').addEventListener('click', () => this.close());
    sheet.querySelector('[data-reset]').addEventListener('click', () => { this.shifts.clear(); this.changed(); });
    sheet.querySelector('[data-tap]').addEventListener('click', () => this.tap());
    sheet.querySelector('[data-save]').addEventListener('click', () => this.save());
    sheet.querySelector('[data-export]').addEventListener('click', () => this.export());
    for (const b of sheet.querySelectorAll('[data-all]')) b.addEventListener('click', () => this.shiftAll(Number(b.dataset.all)));
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const i = Number(row.dataset.i);
      const nudge = e.target.closest('[data-n]');
      if (nudge) { this.nudge(i, Number(nudge.dataset.n)); return; }
      if (e.target.closest('[data-now]')) { this.setStart(i, this.h.time() - REACTION); return; }
      if (e.target.closest('[data-seek]')) { this.h.seek(this.begin(i) - 0.5); }
      this.select(i);
    });
    sheet.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.target.closest('input')) return;
      const k = e.key;
      if (k === 'Escape') this.close();
      else if (k === 't' || k === 'T') { e.preventDefault(); this.tap(); }
      else if (k === ' ') { e.preventDefault(); this.h.togglePlay(); }
      else if (k === 'ArrowDown') { e.preventDefault(); this.select(this.target + 1); }
      else if (k === 'ArrowUp') { e.preventDefault(); this.select(this.target - 1); }
      else if (k === '[') this.nudge(this.target, -0.05);
      else if (k === ']') this.nudge(this.target, 0.05);
      else if (k === 'ArrowLeft') { e.preventDefault(); this.h.seek(this.h.time() - 3); }
      else if (k === 'ArrowRight') { e.preventDefault(); this.h.seek(this.h.time() + 3); }
    });
  }

  get isOpen() { return !this.sheet.hidden; }

  open() {
    const src = this.h.getTtml();
    if (!src?.text || !src.model?.lines.length || src.model.timing === 'none') {
      this.h.toast('Load timed lyrics first, then edit their timing', { error: true });
      return;
    }
    this.original = src;
    this.lines = src.model.lines.filter((l) => l.begin != null);
    this.shifts = new Map();
    this.target = Math.max(0, this.lines.findIndex((l) => l.begin > this.h.time() - 0.2));
    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add('open'));
    this.render();
    this.sheet.querySelector('[data-tap]').focus();
  }

  close() {
    if (this.shifts.size && [...this.shifts.values()].some((v) => v)) {
      // Unsaved changes: put the original lyrics back.
      this.h.preview(this.original.text);
      this.h.toast('Timing changes discarded');
    }
    this.sheet.classList.remove('open');
    setTimeout(() => { if (!this.sheet.classList.contains('open')) this.sheet.hidden = true; }, 320);
  }

  begin(i) { const l = this.lines[i]; return l.begin + (this.shifts.get(l.pIndex) || 0); }

  render() {
    this.list.innerHTML = this.lines.map((l, i) => {
      const d = this.shifts.get(l.pIndex) || 0;
      return `<div class="sync-row${i === this.target ? ' target' : ''}" data-i="${i}">
        <button class="sync-time${d ? ' moved' : ''}" data-seek title="Play from here">${formatTime(this.begin(i))}</button>
        <span class="sync-text">${esc(l.text || l.background?.text || '…')}</span>
        <span class="sync-nudge">
          <button data-n="-0.05" aria-label="50 ms earlier">−</button>
          <button data-n="0.05" aria-label="50 ms later">+</button>
          <button data-now aria-label="Start this line now" title="Start this line now">⏱</button>
        </span>
      </div>`;
    }).join('');
    this.currentRow = -1;
    this.list.querySelector('.target')?.scrollIntoView({ block: 'center' });
  }

  select(i) {
    this.target = Math.min(this.lines.length - 1, Math.max(0, i));
    for (const r of this.list.children) r.classList.toggle('target', Number(r.dataset.i) === this.target);
    this.list.children[this.target]?.scrollIntoView({ block: 'nearest' });
  }

  setStart(i, t) {
    const l = this.lines[i];
    if (!l) return;
    this.shifts.set(l.pIndex, Math.round((t - l.begin) * 1000) / 1000);
    this.changed();
  }

  nudge(i, d) {
    const l = this.lines[i];
    if (!l) return;
    this.shifts.set(l.pIndex, Math.round(((this.shifts.get(l.pIndex) || 0) + d) * 1000) / 1000);
    this.changed();
  }

  shiftAll(d) {
    for (const l of this.lines) this.shifts.set(l.pIndex, Math.round(((this.shifts.get(l.pIndex) || 0) + d) * 1000) / 1000);
    this.changed();
  }

  tap() {
    if (!this.lines.length) return;
    this.setStart(this.target, this.h.time() - REACTION);
    this.select(this.target + 1);
  }

  edited() { return shiftParagraphs(this.original.text, this.shifts); }

  changed() {
    const keep = this.target;
    this.render();
    this.select(keep);
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => this.h.preview(this.edited()), 250);
  }

  save() {
    const text = this.edited();
    this.h.save(text);
    this.original = { ...this.original, text };
    this.lines = this.lines.map((l) => ({ ...l, begin: l.begin + (this.shifts.get(l.pIndex) || 0) }));
    this.shifts.clear();
    this.render();
    this.h.toast('Timing saved with this song');
  }

  export() {
    if (this.h.canExport && !this.h.canExport()) {
      this.h.toast('These lyrics are from Spicy Lyrics, whose terms don’t allow saving them as files', { error: true });
      return;
    }
    const text = this.edited();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/ttml+xml' }));
    a.download = (this.original.name || 'lyrics.ttml').replace(/(\.ttml)?$/i, '.ttml');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /** Highlights the line playing now (called every frame while open). */
  update(t) {
    let cur = -1;
    for (let i = 0; i < this.lines.length; i++) if (this.begin(i) <= t) cur = i; else break;
    if (cur === this.currentRow) return;
    this.list.children[this.currentRow]?.classList.remove('playing');
    this.list.children[cur]?.classList.add('playing');
    this.currentRow = cur;
  }
}
