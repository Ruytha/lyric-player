// "Search Apple Music…" window: find a song in Apple's catalogue, import
// the full track through song-downloader.js, open it in Apple Music, buy it
// on iTunes, or get its synced lyrics as a .ttml file.

import { searchCatalog, ttmlFileName } from './catalog.js';
import { getSongDownloadUrl } from './song-downloader.js';
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
   * options:
   * - onImport(file, song) receives the full downloaded track as a File so the
   *   main player/library can import it.
   * - onPreview is kept as a compatibility hook and is called before import.
   * - motionArt() and appleLyrics() read the matching settings.
   */
  constructor(root, { onPreview, onImport, motionArt = () => true, appleLyrics = () => false, downloadFormat = 'atmos-m4a' } = {}) {
    this.root = root;
    this.onPreview = onPreview;
    this.onImport = onImport;
    this.downloadFormat = downloadFormat;
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

    // Kept for compatibility with the old UI. Full tracks are fetched through
    // song-downloader.js instead of Apple's 30-second previewUrl.
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.playingId = null;

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
        if (this.sel >= 0) this.importSong(this.results[this.sel]); else this.search();
      }
    });
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('[data-import]')) this.importSong(this.results[i]);
      this.select(i, { show: true });
    });
    this.detail.addEventListener('click', (e) => {
      const song = this.results[this.sel];
      if (!song) return;
      if (e.target.closest('[data-back]')) { this.root.classList.remove('showing-detail'); this.list.querySelector('.sel')?.focus(); }
      else if (e.target.closest('[data-import]')) this.importSong(song);
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
        <button class="cat-play${playing ? ' on' : ''}" data-import type="button" aria-label="Import ${esc(r.title)}">${playing ? ICON.pause : ICON.play}</button>
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
      <button class="cat-preview${playing ? ' on' : ''}" data-import type="button">
        <span class="cat-preview-icon">${playing ? ICON.pause : ICON.play}</span>
        <span class="cat-preview-label">${playing ? 'Importing…' : 'Import Full Song'}</span>
        <span class="cat-preview-bar" aria-hidden="true"><span></span></span>
      </button>
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

  // --- Full-track import ------------------------------------------------------

  async importSong(r) {
    if (!r?.id) return;

    // Prevent duplicate imports while this song is being fetched.
    if (this.playingId === r.id) return;

    this.onPreview?.();
    this.playingId = r.id;
    this.refreshPreviewButtons();
    this.status.textContent = `Importing "${r.title}"…`;
    this.root.classList.add('loading');

    try {
      const url = getSongDownloadUrl(
        r.id,
        this.downloadFormat,
        r.storefront || 'en'
      );

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download server returned HTTP ${response.status}`);
      }

      const blob = await response.blob();
      const ext = this.downloadFormat === 'alac-flac' ? 'flac'
        : this.downloadFormat === 'atmos-mp4' ? 'mp4'
        : this.downloadFormat === 'aac-m4a' ? 'm4a'
        : this.downloadFormat === 'mp3-320' ? 'mp3'
        : 'm4a';

      const safe = `${r.artist ? `${r.artist} - ` : ''}${r.title || `Track_${r.id}`}`
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\\s+/g, ' ')
        .trim();

      const file = new File([blob], `${safe}.${ext}`, {
        type: blob.type || (ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4')
      });

      if (this.onImport) {
        await this.onImport(file, r);
        this.status.textContent = `Imported "${r.title}".`;
      } else {
        // Safe fallback when the host player has not supplied an importer.
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
        this.status.textContent = `Downloaded "${r.title}".`;
      }
    } catch (err) {
      console.error('[Catalog] Full-track import failed:', err);
      this.status.textContent = `Couldn’t import "${r.title}". ${err.message || ''}`.trim();
    } finally {
      this.root.classList.remove('loading');
      this.playingId = null;
      this.refreshPreviewButtons();
    }
  }

  stopPreview() {
    this.playingId = null;
    this.refreshPreviewButtons();
  }

  refreshPreviewButtons() {
    for (const row of this.list.children) {
      const r = this.results[Number(row.dataset.i)];
      const btn = row.querySelector('[data-import]');
      if (!btn || !r) continue;
      const on = r.id === this.playingId;
      btn.classList.toggle('on', on);
      btn.innerHTML = on ? ICON.pause : ICON.play;
      btn.setAttribute('aria-label', `${on ? 'Importing' : 'Import'} ${r.title}`);
    }
    const r = this.results[this.sel];
    const btn = this.detail.querySelector('[data-import]');
    if (!btn || !r) return;
    const on = r.id === this.playingId;
    btn.classList.toggle('on', on);
    btn.querySelector('.cat-preview-icon').innerHTML = on ? ICON.pause : ICON.play;
    btn.querySelector('.cat-preview-label').textContent = on ? 'Importing…' : 'Import Full Song';
  }

  updateProgress() {
    // Kept as a no-op for compatibility with the existing UI/CSS.
    const bar = this.detail.querySelector('.cat-preview-bar > span');
    if (bar) bar.style.width = '0%';
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
