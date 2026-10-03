// "Find cover" window: search Apple Music albums, see which have an animated
// cover, pick one for the current song.

import { searchAlbums, fetchMotionArt } from './apple-art.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class ArtSearchDialog {
  constructor(root, { onPick } = {}) {
    this.root = root;
    this.onPick = onPick;
    this.input = root.querySelector('input');
    this.list = root.querySelector('.ls-results');
    this.status = root.querySelector('.ls-status');
    this.results = [];
    this.sel = -1;
    this.req = 0;
    this.timer = 0;

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.search(), 350);
    });
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(this.timer);
        if (this.sel >= 0) this.pick(this.sel); else this.search();
      }
    });
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (row) this.pick(Number(row.dataset.i));
    });
    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
  }

  get isOpen() { return !this.root.hidden; }

  open(query = '') {
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('open'));
    if (query) this.input.value = query;
    this.input.focus();
    this.input.select();
    if (this.input.value.trim()) this.search();
    else this.render([], 'Search by song or album, and artist.');
  }

  close() {
    this.root.classList.remove('open');
    setTimeout(() => { if (!this.root.classList.contains('open')) this.root.hidden = true; }, 250);
  }

  async search() {
    const q = this.input.value.trim();
    const id = ++this.req;
    if (q.length < 2) { this.render([], 'Search by song or album, and artist.'); return; }
    this.status.textContent = 'Searching Apple Music…';
    this.root.classList.add('loading');
    let results = [];
    try {
      results = await searchAlbums(q, { limit: 30 });
    } catch (e) {
      if (id !== this.req) return;
      this.root.classList.remove('loading');
      this.render([], `Couldn't search: ${e.message}`);
      return;
    }
    if (id !== this.req) return;
    this.root.classList.remove('loading');
    results = results.slice(0, 12);
    this.render(results, results.length ? '' : 'No albums found. Try fewer words.');
    // Check which albums have an animated cover.
    let relayError = null;
    await Promise.all(results.map(async (r, i) => {
      try {
        r.motion = await fetchMotionArt(r.collectionId, r.storefront);
      } catch (e) {
        r.motion = null;
        relayError = e.message;
      }
      if (id === this.req) this.updateRow(i);
    }));
    if (id !== this.req) return;
    const animated = results.filter((r) => r.motion?.square).length;
    this.status.textContent = relayError && !animated
      ? `Covers only: ${relayError}.`
      : `${results.length} album${results.length === 1 ? '' : 's'} · ${animated} animated`;
  }

  rowHtml(r, i) {
    const badge = r.motion === undefined
      ? '<span class="ls-badge pending">Checking…</span>'
      : r.motion?.square ? '<span class="ls-badge word">Animated</span>' : '<span class="ls-badge">Still</span>';
    return `<button class="ls-row art-row${i === this.sel ? ' sel' : ''}" data-i="${i}" role="option" aria-selected="${i === this.sel}">
      <img class="as-thumb" src="${esc(r.thumb)}" alt="" loading="lazy">
      <span class="ls-main"><span class="ls-title">${esc(r.album)}</span><span class="ls-sub">${esc([r.artist, r.year].filter(Boolean).join(' · '))}</span></span>
      <span class="ls-meta">${badge}</span>
    </button>`;
  }

  render(results, note) {
    this.results = results;
    this.sel = results.length ? 0 : -1;
    this.status.textContent = note || `${results.length} album${results.length === 1 ? '' : 's'}`;
    this.list.innerHTML = results.map((r, i) => this.rowHtml(r, i)).join('');
  }

  updateRow(i) {
    const old = this.list.querySelector(`[data-i="${i}"]`);
    if (!old) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = this.rowHtml(this.results[i], i);
    old.replaceWith(tmp.firstElementChild);
  }

  move(d) {
    if (!this.results.length) return;
    this.sel = (this.sel + d + this.results.length) % this.results.length;
    for (const row of this.list.children) {
      const on = Number(row.dataset.i) === this.sel;
      row.classList.toggle('sel', on);
      row.setAttribute('aria-selected', String(on));
      if (on) row.scrollIntoView({ block: 'nearest' });
    }
  }

  async pick(i) {
    const r = this.results[i];
    if (!r) return;
    if (r.motion === undefined) {
      this.status.textContent = 'Checking for an animated cover…';
      try { r.motion = await fetchMotionArt(r.collectionId, r.storefront); } catch { r.motion = null; }
    }
    this.onPick?.(r);
    this.close();
  }
}
