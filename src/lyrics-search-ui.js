// "Find lyrics" window: type a song, pick a result, lyrics load into the player.

import { searchLyrics, getTtml, loadAmllIndex, SOURCE_NAMES } from './lyrics-search.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

export class LyricsSearchDialog {
  /** options(): extra search options, e.g. { apple: true }. */
  constructor(root, { onPick, onError, options = () => ({}) } = {}) {
    this.root = root;
    this.options = options;
    this.onPick = onPick;
    this.onError = onError;
    this.input = root.querySelector('input');
    this.list = root.querySelector('.ls-results');
    this.status = root.querySelector('.ls-status');
    this.results = [];
    this.sel = -1;
    this.req = 0;
    this.timer = 0;
    this.busy = false;

    this.input.addEventListener('input', () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.search(), 300);
    });
    root.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing here must not trigger player shortcuts
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(this.timer);
        if (this.sel >= 0) this.pick(this.sel);
        else this.search();
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

  /** query: optional text to search straight away (e.g. the current song). */
  open(query = '') {
    this.root.hidden = false;
    requestAnimationFrame(() => this.root.classList.add('open'));
    if (query && !this.input.value) this.input.value = query;
    this.input.focus();
    this.input.select();
    loadAmllIndex().catch(() => {}); // warm up the database index
    if (this.input.value.trim()) this.search();
    else this.render([], 'Search by song title and artist.');
  }

  close() {
    this.root.classList.remove('open');
    setTimeout(() => { if (!this.root.classList.contains('open')) this.root.hidden = true; }, 250);
  }

  async search() {
    const q = this.input.value.trim();
    const id = ++this.req;
    if (q.length < 2) { this.render([], 'Search by song title and artist.'); return; }
    this.status.textContent = 'Searching…';
    this.root.classList.add('loading');
    const { results, errors } = await searchLyrics(q, this.options());
    if (id !== this.req) return;
    this.root.classList.remove('loading');
    const note = results.length
      ? errors.length ? `Some sources didn't respond (${errors.join('; ')}).` : ''
      : errors.length ? `Couldn't search: ${errors.join('; ')}` : 'No synced lyrics found. Try fewer words, or just the title.';
    this.render(results, note);
  }

  render(results, note) {
    this.results = results;
    this.sel = results.length ? 0 : -1;
    this.status.textContent = note || `${results.length} result${results.length === 1 ? '' : 's'}`;
    this.list.innerHTML = results.map((r, i) => {
      const artists = r.artists.slice(0, 2).join(', ');
      const sub = [artists, r.album].filter(Boolean).join(' · ');
      const word = r.source === 'amll' || r.wordSync;
      const badge = word
        ? '<span class="ls-badge word">Word-synced</span>'
        : `<span class="ls-badge">${r.wordSync === false ? 'Line-synced' : r.source === 'lrclib' ? 'Line-synced' : 'Synced'}</span>`;
      const src = r.source === 'amll'
        ? `AMLL TTML DB${r.author ? ` · by @${esc(r.author)}` : ''}`
        : `${SOURCE_NAMES[r.source] || r.source}${r.duration ? ` · ${fmtDur(r.duration)}` : ''}`;
      const cls = r.source === 'apple' ? ' ls-apple' : '';
      return `<button class="ls-row${cls}${i === this.sel ? ' sel' : ''}" data-i="${i}" role="option" aria-selected="${i === this.sel}">
        <span class="ls-main"><span class="ls-title">${esc(r.title)}</span><span class="ls-sub">${esc(sub)}</span></span>
        <span class="ls-meta">${badge}<span class="ls-src">${src}</span></span>
      </button>`;
    }).join('');
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
    if (!r || this.busy) return;
    this.busy = true;
    this.status.textContent = `Loading lyrics for ${r.title}…`;
    try {
      const ttml = await getTtml(r);
      this.onPick?.(ttml, r);
      this.close();
    } catch (e) {
      this.status.textContent = `Couldn't load those lyrics (${e.message}).`;
      this.onError?.(e);
    } finally {
      this.busy = false;
    }
  }
}
