// "Search Apple Music…" window: find a song in Apple's catalogue, hear its
// 30-second preview, open it in Apple Music, buy it on iTunes, or get its
// synced lyrics as a .ttml file. Nothing here downloads songs.

import { searchCatalog, ttmlFileName } from './catalog.js';
import { fetchMotionArt } from './apple-art.js';
import { MotionArtwork } from './motion-art.js';
import { searchLyrics, getTtml, SOURCE_NAMES } from './lyrics-search.js';
import { fetchBestLyrics } from './auto-lyrics.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDur = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
};

export class CatalogDialog {
  /**
   * options: onPreview() is called when a preview starts (to pause the player),
   * motionArt() and appleLyrics() read the matching settings.
   */
  constructor(root, { onPreview, motionArt = () => true, appleLyrics = () => false } = {}) {
    this.root = root;
    this.onPreview = onPreview;
    this.motionArt = motionArt;
    this.appleLyrics = appleLyrics;
    this.input = root.querySelector('input');
    this.list = root.querySelector('.ls-results');
    this.status = root.querySelector('.ls-status');
    this.detail = root.querySelector('.cat-detail');
    this.results = [];
    this.sel = -1;
    this.req = 0;
    this.timer = 0;
    this.lyrics = new Map(); // song id → { state, text, note }

    this.audio = new Audio();
    this.audio.preload = 'none';
    this.playingId = null;
    this.audio.addEventListener('timeupdate', () => this.updateProgress());
    this.audio.addEventListener('ended', () => this.stopPreview());
    this.audio.addEventListener('error', () => {
      if (!this.playingId) return;
      this.stopPreview();
      this.status.textContent = 'This preview couldn’t play. Check your connection.';
    });

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.search(), 350);
    });
    root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keep typing away from the player shortcuts
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.select(this.sel + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.select(this.sel - 1); }
      else if (e.key === 'Enter' && e.target === this.input) {
        e.preventDefault();
        clearTimeout(this.timer);
        if (this.sel >= 0) this.togglePreview(this.results[this.sel]); else this.search();
      }
    });
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('[data-preview]')) this.togglePreview(this.results[i]);
      this.select(i, { show: true });
    });
    this.detail.addEventListener('click', (e) => {
      const song = this.results[this.sel];
      if (!song) return;
      if (e.target.closest('[data-back]')) { this.root.classList.remove('showing-detail'); this.list.querySelector('.sel')?.focus(); }
      else if (e.target.closest('[data-preview]')) this.togglePreview(song);
      else if (e.target.closest('[data-lyrics]')) this.getLyrics(song);
      else if (e.target.closest('[data-save]')) this.saveLyrics(song);
    });
    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
  }

  get isOpen() { return !this.root.hidden; }

  open(query = '') {
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('open'));
    if (query && !this.input.value) this.input.value = query;
    this.input.focus();
    this.input.select();
    if (this.input.value.trim() && !this.results.length) this.search();
    else if (!this.results.length) this.render([], 'Search for any song in Apple Music.');
  }

  close() {
    this.stopPreview();
    this.motion?.play(null);
    this.root.classList.remove('open', 'showing-detail');
    setTimeout(() => { if (!this.root.classList.contains('open')) this.root.hidden = true; }, 250);
  }

  async search() {
    const q = this.input.value.trim();
    const id = ++this.req;
    if (q.length < 2) { this.render([], 'Search for any song in Apple Music.'); return; }
    this.status.textContent = 'Searching Apple Music…';
    this.root.classList.add('loading');
    let results = [];
    try {
      results = await searchCatalog(q);
    } catch (e) {
      if (id !== this.req) return;
      this.root.classList.remove('loading');
      this.render([], `Couldn’t search Apple Music. Are you offline? (${e.message})`);
      return;
    }
    if (id !== this.req) return;
    this.root.classList.remove('loading');
    this.render(results, results.length ? '' : 'No songs found. Try fewer words.');
  }

  render(results, note) {
    this.results = results;
    this.sel = -1;
    this.status.textContent = note || `${results.length} song${results.length === 1 ? '' : 's'}`;
    this.list.innerHTML = results.map((r, i) => this.rowHtml(r, i)).join('');
    this.root.classList.remove('showing-detail');
    if (results.length) this.select(0);
    else { this.detail.hidden = true; this.motion?.play(null); }
  }

  rowHtml(r, i) {
    const playing = r.id === this.playingId;
    return `<div class="ls-row cat-row${i === this.sel ? ' sel' : ''}" id="cat-row-${i}" data-i="${i}" role="option" aria-selected="${i === this.sel}" tabindex="-1">
      <span class="cat-thumb">
        <img src="${esc(r.thumb)}" alt="" loading="lazy">
        ${r.preview ? `<button class="cat-play${playing ? ' on' : ''}" data-preview type="button" aria-label="${playing ? 'Stop preview of' : 'Preview'} ${esc(r.title)}">${playing ? ICON.pause : ICON.play}</button>` : ''}
      </span>
      <span class="ls-main"><span class="ls-title">${esc(r.title)}${r.explicit ? ' <span class="cat-e" title="Explicit" aria-label="Explicit">E</span>' : ''}</span><span class="ls-sub">${esc([r.artist, r.album].filter(Boolean).join(' · '))}</span></span>
      <span class="ls-meta"><span class="ls-src">${fmtDur(r.duration)}</span></span>
    </div>`;
  }

  select(i, { show = false } = {}) {
    if (!this.results.length) return;
    i = Math.max(0, Math.min(this.results.length - 1, i));
    const changed = i !== this.sel;
    this.sel = i;
    for (const row of this.list.children) {
      const on = Number(row.dataset.i) === i;
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', String(on));
      if (on) row.scrollIntoView({ block: 'nearest' });
    }
    this.input.setAttribute('aria-activedescendant', `cat-row-${i}`); // screen readers follow the arrow keys
    if (changed) this.showDetail(this.results[i]);
    if (show) { // narrow windows: the song replaces the list
      this.root.classList.add('showing-detail');
      this.detail.scrollTop = 0;
    }
  }

  showDetail(r) {
    const lyr = this.lyrics.get(r.id);
    const playing = r.id === this.playingId;
    const info = [r.album, r.year, r.genre].filter(Boolean).join(' · ');
    this.detail.hidden = false;
    this.detail.innerHTML = `
      <button class="cat-back link-btn" data-back type="button">${ICON.back}Results</button>
      <div class="cat-art"><img src="${esc(r.artwork)}" alt=""></div>
      <h3 class="cat-title">${esc(r.title)}${r.explicit ? ' <span class="cat-e" title="Explicit" aria-label="Explicit">E</span>' : ''}</h3>
      <div class="cat-artist">${esc(r.artist)}</div>
      <div class="cat-info">${esc(info)}</div>
      ${r.preview ? `<button class="cat-preview${playing ? ' on' : ''}" data-preview type="button">
        <span class="cat-preview-icon">${playing ? ICON.pause : ICON.play}</span>
        <span class="cat-preview-label">${playing ? 'Stop Preview' : 'Preview'}</span>
        <span class="cat-preview-bar" aria-hidden="true"><span></span></span>
      </button>` : '<div class="cat-info">No preview for this song.</div>'}
      <div class="cat-actions">
        ${r.appleMusicUrl ? `<a class="pill pill-small" href="${esc(r.appleMusicUrl)}" target="_blank" rel="noopener">Open in Apple Music</a>` : ''}
        ${r.storeUrl && r.price ? `<a class="pill pill-small pill-ghost" href="${esc(r.storeUrl)}" target="_blank" rel="noopener">Buy on iTunes · ${esc(r.price)}</a>` : ''}
      </div>
      <div class="cat-lyrics">${this.lyricsHtml(lyr)}</div>`;
    this.detail.scrollTop = 0;
    this.updateProgress();
    this.showMotion(r);
  }

  lyricsHtml(lyr) {
    if (!lyr) return '<button class="pill pill-small pill-ghost" data-lyrics type="button">Get Lyrics</button>';
    if (lyr.state === 'loading') return '<span class="cat-note">Looking for lyrics…</span>';
    if (lyr.state === 'none') return `<span class="cat-note">${esc(lyr.note)}</span> <button class="link-btn" data-lyrics type="button">Try Again</button>`;
    return `<span class="cat-note">${esc(lyr.note)}</span> <button class="pill pill-small pill-ghost" data-save type="button">Save .ttml</button>`;
  }

  async showMotion(r) {
    const host = this.detail.querySelector('.cat-art');
    this.motion?.play(null);
    if (!host || !r.collectionId || !this.motionArt()) return;
    // One video element, moved into each new cover box.
    if (!this.motion) this.motion = new MotionArtwork(host);
    else host.appendChild(this.motion.video);
    this.motion.host = host;
    try {
      const m = await fetchMotionArt(r.collectionId, r.storefront);
      if (this.results[this.sel] !== r || !m?.square) return;
      await this.motion.play(m.square);
    } catch { /* still cover only */ }
  }

  // --- Preview ---------------------------------------------------------------

  togglePreview(r) {
    if (!r?.preview) return;
    if (this.playingId === r.id) { this.stopPreview(); return; }
    this.onPreview?.();
    this.playingId = r.id;
    this.audio.src = r.preview;
    this.audio.play().catch(() => {});
    this.refreshPreviewButtons();
  }

  stopPreview() {
    if (!this.playingId) return;
    this.playingId = null;
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.refreshPreviewButtons();
  }

  refreshPreviewButtons() {
    for (const row of this.list.children) {
      const r = this.results[Number(row.dataset.i)];
      const btn = row.querySelector('[data-preview]');
      if (!btn || !r) continue;
      const on = r.id === this.playingId;
      btn.classList.toggle('on', on);
      btn.innerHTML = on ? ICON.pause : ICON.play;
      btn.setAttribute('aria-label', `${on ? 'Stop preview of' : 'Preview'} ${r.title}`);
    }
    const r = this.results[this.sel];
    const btn = this.detail.querySelector('.cat-preview');
    if (!btn || !r) return;
    const on = r.id === this.playingId;
    btn.classList.toggle('on', on);
    btn.querySelector('.cat-preview-icon').innerHTML = on ? ICON.pause : ICON.play;
    btn.querySelector('.cat-preview-label').textContent = on ? 'Stop Preview' : 'Preview';
    this.updateProgress();
  }

  updateProgress() {
    const bar = this.detail.querySelector('.cat-preview-bar > span');
    if (!bar) return;
    const on = this.results[this.sel]?.id === this.playingId && this.audio.duration > 0;
    bar.style.width = on ? `${(this.audio.currentTime / this.audio.duration) * 100}%` : '0%';
  }

  // --- Lyrics ------------------------------------------------------------------

  async getLyrics(r) {
    this.lyrics.set(r.id, { state: 'loading' });
    this.refreshLyrics(r);
    const song = { title: r.title, artist: r.artist, duration: r.duration };
    let found = null;
    try {
      const { results } = await searchLyrics(`${r.title} ${r.artist}`, { apple: this.appleLyrics() });
      found = await fetchBestLyrics(results, song, getTtml);
    } catch { /* falls through to "none" */ }
    if (!found) {
      this.lyrics.set(r.id, { state: 'none', note: 'No synced lyrics found for this song.' });
    } else {
      const kind = found.best.wordSync || found.best.source === 'amll' ? 'Word-synced' : 'Line-synced';
      this.lyrics.set(r.id, { state: 'ok', text: found.ttml, note: `${kind} lyrics from ${SOURCE_NAMES[found.best.source] || found.best.source}.` });
    }
    this.refreshLyrics(r);
  }

  refreshLyrics(r) {
    if (this.results[this.sel] !== r) return;
    const box = this.detail.querySelector('.cat-lyrics');
    if (box) box.innerHTML = this.lyricsHtml(this.lyrics.get(r.id));
    box?.querySelector('button')?.focus();
  }

  saveLyrics(r) {
    const lyr = this.lyrics.get(r.id);
    if (!lyr?.text) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lyr.text], { type: 'application/ttml+xml' }));
    a.download = ttmlFileName(r);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
