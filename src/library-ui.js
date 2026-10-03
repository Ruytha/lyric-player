// Library sheet: Up Next (the queue), Songs (everything remembered, plus music
// folders in the desktop app) and Playlists.

import { fold } from './lyrics-search.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmtDur = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');
const PAGE = 300;

const ICON = {
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.2c2 0 3.1.8 4.2 2.5l2.9 5c1.1 1.7 2.2 2.5 4.2 2.5H21M3 17h3.2c1.5 0 2.4-.4 3.2-1.3M13.6 8.3c.8-.9 1.8-1.3 3.3-1.3H21M18.4 4.4 21 7l-2.6 2.6M18.4 14.4 21 17l-2.6 2.6"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11.5V10a3 3 0 0 1 3-3h13M17.2 4.2 20 7l-2.8 2.8M20 12.5V14a3 3 0 0 1-3 3H4M6.8 19.8 4 17l2.8-2.8"/></svg>',
  grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
};

export class LibraryPanel {
  /**
   * h: { library, queue, currentId(), play(ids, startId), jump(index), forget(id),
   *      folders(), addFolder(), removeFolder(dir), showInFolder(path), toast(msg), desktop }
   */
  constructor(sheet, h) {
    this.sheet = sheet;
    this.h = h;
    this.body = sheet.querySelector('.lib-body');
    this.tab = 'next';
    this.songs = [];
    this.byId = new Map();
    this.playlists = [];
    this.openPlaylist = null;
    this.filter = '';
    this.lyricFold = new Map(); // id → folded lyrics, for searching by a line
    this.indexed = false;
    this.sort = 'recent';
    this.limit = PAGE;
    this.menu = null;

    for (const b of sheet.querySelectorAll('[data-tab]')) b.addEventListener('click', () => this.show(b.dataset.tab));
    sheet.querySelector('[data-close]').addEventListener('click', () => this.close());
    sheet.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { if (this.menu) this.closeMenu(); else this.close(); }
    });
    this.body.addEventListener('click', (e) => this.onClick(e));
    this.body.addEventListener('input', (e) => {
      if (e.target.matches('.lib-search')) {
        this.filter = e.target.value;
        this.limit = PAGE;
        this.renderSongRows();
        // First search by lyrics: add the lyrics text of older songs, then search again.
        if (!this.indexed && this.filter.trim().length >= 3 && this.h.indexLyrics) {
          this.indexed = true;
          this.h.indexLyrics().then((n) => (n ? this.refresh() : null)).catch(() => {});
        }
      }
    });
    this.body.addEventListener('change', (e) => {
      if (e.target.matches('.lib-sort')) { this.sort = e.target.value; this.renderSongRows(); }
    });
    this.bindDrag();
    document.addEventListener('pointerdown', (e) => { if (this.menu && !e.target.closest('.row-menu')) this.closeMenu(); }, true);
    h.queue.onChange(() => { if (this.isOpen && this.tab === 'next') this.render(); });
  }

  get isOpen() { return !this.sheet.hidden; }

  async open(tab) {
    if (tab) this.tab = tab;
    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add('open'));
    await this.refresh();
  }

  close() {
    this.closeMenu();
    this.sheet.classList.remove('open');
    setTimeout(() => { if (!this.sheet.classList.contains('open')) this.sheet.hidden = true; }, 320);
    this.h.onClose?.();
  }

  toggle(tab) { if (this.isOpen && (!tab || tab === this.tab)) this.close(); else this.open(tab); }

  async refresh() {
    this.songs = await this.h.library.list().catch(() => []);
    this.byId = new Map(this.songs.map((s) => [s.id, s]));
    this.lyricFold.clear();
    this.playlists = await this.h.library.playlists().catch(() => []);
    if (this.isOpen) this.render();
  }

  show(tab) {
    this.tab = tab;
    this.openPlaylist = null;
    this.render();
  }

  render() {
    for (const b of this.sheet.querySelectorAll('[data-tab]')) b.setAttribute('aria-checked', String(b.dataset.tab === this.tab));
    this.closeMenu();
    if (this.tab === 'next') this.renderNext();
    else if (this.tab === 'songs') this.renderSongs();
    else this.renderPlaylists();
  }

  // ------------------------------------------------------------------ rows

  row(song, { index = null, drag = false, kind = 'song', hit = null } = {}) {
    const s = song || { id: '', title: 'Missing song' };
    const cur = s.id === this.h.currentId();
    const sub = [s.artist, s.album].filter(Boolean).join(' · ') || (s.path ? s.folder || '' : '');
    return `<div class="lr${cur ? ' current' : ''}" data-id="${esc(s.id)}"${index != null ? ` data-index="${index}"` : ''}${drag ? ' draggable="true"' : ''} data-kind="${kind}">
      ${drag ? `<span class="lr-grip" aria-hidden="true">${ICON.grip}</span>` : ''}
      <button class="lr-main" data-play type="button">
        <span class="lib-art">${s.thumb ? `<img src="${esc(s.thumb)}" alt="" loading="lazy">` : ''}</span>
        <span class="lib-text"><span class="lib-title">${esc(s.title || s.audioName || 'Unknown')}</span><span class="lib-sub">${esc(sub)}${s.hasLyrics ? '' : `${sub ? ' · ' : ''}<em>no lyrics</em>`}</span>${hit ? `<span class="lib-hit">“${esc(hit)}”</span>` : ''}</span>
        <span class="lr-dur">${fmtDur(s.duration)}</span>
      </button>
      <button class="lr-more" data-more type="button" aria-label="More for ${esc(s.title || s.audioName)}">${ICON.more}</button>
    </div>`;
  }

  // -------------------------------------------------------------- up next

  renderNext() {
    const q = this.h.queue;
    const cur = this.byId.get(q.current);
    const up = q.items.map((id, i) => ({ id, i })).slice(q.pos + 1);
    const repeatLabel = { off: 'Repeat: off', all: 'Repeat: all', one: 'Repeat: this song' }[q.repeat];
    this.body.innerHTML = `
      <div class="q-controls">
        <button class="qtoggle" data-act="shuffle" aria-pressed="${q.shuffle}" aria-label="Shuffle" title="Shuffle">${ICON.shuffle}</button>
        <button class="qtoggle" data-act="repeat" aria-pressed="${q.repeat !== 'off'}" data-mode="${q.repeat}" aria-label="${repeatLabel}" title="${repeatLabel}">${ICON.repeat}<span class="one">1</span></button>
      </div>
      <h3 class="sheet-section">Now Playing</h3>
      <div class="sheet-group lr-list">${cur ? this.row(cur, { index: q.pos, kind: 'queue' }) : '<div class="queue-empty">Nothing playing. Pick a song in Songs.</div>'}</div>
      <div class="lib-section-head"><h3 class="sheet-section">Up Next</h3>${up.length ? '<button class="link-btn" data-act="clear">Clear</button>' : ''}</div>
      <div class="sheet-group lr-list" data-list="queue">${up.length ? up.map(({ id, i }) => this.row(this.byId.get(id) || { id, title: 'Missing song' }, { index: i, drag: true, kind: 'queue' })).join('') : `<div class="queue-empty">${q.repeat === 'all' && q.items.length ? 'Repeating from the start.' : 'Nothing queued. Use ••• → Play Next on any song.'}</div>`}</div>`;
  }

  // ---------------------------------------------------------------- songs

  renderSongs() {
    const desktop = this.h.desktop;
    this.body.innerHTML = `
      <div class="lib-tools">
        <input class="lib-search" type="search" placeholder="Search songs or lyrics" value="${esc(this.filter)}" autocomplete="off" spellcheck="false" aria-label="Search songs">
        <select class="lib-sort" aria-label="Sort">
          ${[['recent', 'Recent'], ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album']].map(([v, t]) => `<option value="${v}"${this.sort === v ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      ${desktop ? `<div class="lib-folders"></div>` : ''}
      <div class="lib-count"></div>
      <div class="sheet-group lr-list" data-list="songs"></div>`;
    if (desktop) this.renderFolders();
    this.renderSongRows();
  }

  async renderFolders() {
    const host = this.body.querySelector('.lib-folders');
    if (!host) return;
    const dirs = await this.h.folders().catch(() => []);
    host.innerHTML = `${dirs.map((d) => `<span class="folder-chip" title="${esc(d)}">${esc(d.split(/[\\/]/).filter(Boolean).pop() || d)}<button data-act="remove-folder" data-folder="${esc(d)}" aria-label="Remove folder ${esc(d)}">${ICON.x}</button></span>`).join('')}
      <button class="pill pill-small" data-act="add-folder">Add music folder…</button>`;
  }

  /** The line of a song's lyrics that contains the phrase, or null. */
  lyricHit(s, f) {
    if (!s.lyricsText || f.length < 3) return null;
    let folded = this.lyricFold.get(s.id);
    if (folded == null) { folded = fold(s.lyricsText.replace(/\n/g, ' ')); this.lyricFold.set(s.id, folded); }
    if (!folded.includes(f)) return null;
    const lines = s.lyricsText.split('\n');
    return lines.find((l) => fold(l).includes(f)) || lines.find((l) => f.split(' ').some((t) => fold(l).includes(t))) || null;
  }

  visibleSongs() {
    const f = fold(this.filter.trim());
    let list = this.songs;
    this.hits = new Map();
    if (f) {
      const terms = f.split(/\s+/);
      const byName = list.filter((s) => {
        const hay = fold(`${s.title || ''} ${s.artist || ''} ${s.album || ''} ${s.audioName || ''}`);
        return terms.every((t) => hay.includes(t));
      });
      const named = new Set(byName.map((s) => s.id));
      const byLyrics = list.filter((s) => {
        if (named.has(s.id)) return false;
        const hit = this.lyricHit(s, f);
        if (hit) this.hits.set(s.id, hit);
        return !!hit;
      });
      list = byName.concat(byLyrics);
    }
    const key = (s, k) => fold(s[k] || (k === 'title' ? s.audioName : '') || '￿');
    if (this.sort === 'title') list = list.slice().sort((a, b) => key(a, 'title').localeCompare(key(b, 'title')));
    else if (this.sort === 'artist') list = list.slice().sort((a, b) => key(a, 'artist').localeCompare(key(b, 'artist')) || key(a, 'album').localeCompare(key(b, 'album')) || (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0));
    else if (this.sort === 'album') list = list.slice().sort((a, b) => key(a, 'album').localeCompare(key(b, 'album')) || (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0));
    return list;
  }

  renderSongRows() {
    const host = this.body.querySelector('[data-list="songs"]');
    if (!host) return;
    const list = this.visibleSongs();
    this.visible = list;
    const count = this.body.querySelector('.lib-count');
    if (count) count.textContent = this.songs.length ? `${list.length} of ${this.songs.length} songs` : '';
    host.innerHTML = list.length
      ? list.slice(0, this.limit).map((s) => this.row(s, { hit: this.hits?.get(s.id) })).join('') + (list.length > this.limit ? `<button class="link-btn lib-more" data-act="more">Show more (${list.length - this.limit})</button>` : '')
      : `<div class="queue-empty">${this.songs.length ? 'No songs match.' : this.h.desktop ? 'Add a music folder, or drop songs on the player.' : 'Songs you add are remembered here, in this browser.'}</div>`;
  }

  // ------------------------------------------------------------ playlists

  renderPlaylists() {
    const p = this.openPlaylist && this.playlists.find((x) => x.id === this.openPlaylist);
    if (p) {
      this.body.innerHTML = `
        <div class="pl-head">
          <button class="sheet-btn pl-back" data-act="pl-back" aria-label="All playlists">${ICON.back}</button>
          <h3 class="pl-name" title="Rename">${esc(p.name)}</h3>
        </div>
        <div class="pl-actions">
          <button class="pill pill-small" data-act="pl-play" ${p.songs.length ? '' : 'disabled'}>Play</button>
          <button class="pill pill-small pill-ghost" data-act="pl-shuffle" ${p.songs.length ? '' : 'disabled'}>Shuffle</button>
          <button class="pill pill-small pill-ghost" data-act="pl-rename">Rename</button>
          <button class="pill pill-small pill-ghost danger" data-act="pl-delete">Delete</button>
        </div>
        <div class="sheet-group lr-list" data-list="playlist">${p.songs.length ? p.songs.map((id, i) => this.row(this.byId.get(id) || { id, title: 'Missing song' }, { index: i, drag: true, kind: 'playlist' })).join('') : '<div class="queue-empty">Empty. Use ••• → Add to Playlist on any song.</div>'}</div>`;
      return;
    }
    this.body.innerHTML = `
      <button class="pill pill-small" data-act="pl-new">New playlist</button>
      <div class="sheet-group lr-list pl-list">${this.playlists.length ? this.playlists.map((x) => `
        <button class="pl-row" data-playlist="${esc(x.id)}"><span class="pl-icon" aria-hidden="true">♫</span><span class="lib-text"><span class="lib-title">${esc(x.name)}</span><span class="lib-sub">${x.songs.length} song${x.songs.length === 1 ? '' : 's'}</span></span></button>`).join('') : '<div class="queue-empty">No playlists yet.</div>'}</div>`;
  }

  // -------------------------------------------------------------- actions

  listIds(kind) {
    if (kind === 'queue') return this.h.queue.items;
    if (kind === 'playlist') return this.playlists.find((x) => x.id === this.openPlaylist)?.songs || [];
    return (this.visible || this.visibleSongs()).map((s) => s.id);
  }

  async onClick(e) {
    const act = e.target.closest('[data-act]');
    if (act) { await this.action(act.dataset.act, act); return; }
    const pl = e.target.closest('[data-playlist]');
    if (pl) { this.openPlaylist = pl.dataset.playlist; this.renderPlaylists(); return; }
    if (e.target.closest('.pl-name')) { this.action('pl-rename'); return; }
    const row = e.target.closest('.lr');
    if (!row) return;
    const id = row.dataset.id, kind = row.dataset.kind;
    if (e.target.closest('[data-more]')) { this.openMenu(e.target.closest('[data-more]'), row); return; }
    if (e.target.closest('[data-play]')) {
      if (kind === 'queue') this.h.jump(Number(row.dataset.index));
      else this.h.play(this.listIds(kind), id);
    }
  }

  async action(name, el) {
    const q = this.h.queue;
    switch (name) {
      case 'shuffle': q.setShuffle(!q.shuffle); break;
      case 'repeat': q.cycleRepeat(); break;
      case 'clear': q.clearUpcoming(); break;
      case 'more': this.limit += PAGE; this.renderSongRows(); break;
      case 'add-folder': {
        const added = await this.h.addFolder();
        if (added) { this.renderFolders(); }
        break;
      }
      case 'remove-folder': await this.h.removeFolder(el.dataset.folder); this.renderFolders(); break;
      case 'pl-new': {
        const name = await this.ask('New playlist', 'Playlist name');
        if (!name) break;
        const p = { id: `pl-${Date.now().toString(36)}`, name, songs: [] };
        await this.h.library.savePlaylist(p);
        await this.refresh();
        this.openPlaylist = p.id;
        this.renderPlaylists();
        break;
      }
      case 'pl-back': this.openPlaylist = null; this.renderPlaylists(); break;
      case 'pl-play': case 'pl-shuffle': {
        const p = this.playlists.find((x) => x.id === this.openPlaylist);
        if (!p?.songs.length) break;
        q.setShuffle(name === 'pl-shuffle');
        this.h.play(p.songs, name === 'pl-shuffle' ? p.songs[Math.floor(Math.random() * p.songs.length)] : p.songs[0]);
        break;
      }
      case 'pl-rename': {
        const p = this.playlists.find((x) => x.id === this.openPlaylist);
        const nameNew = p && await this.ask('Rename playlist', 'Playlist name', p.name);
        if (nameNew) { await this.h.library.savePlaylist({ ...p, name: nameNew }); await this.refresh(); }
        break;
      }
      case 'pl-delete': {
        const p = this.playlists.find((x) => x.id === this.openPlaylist);
        if (p && await this.confirm(`Delete “${p.name}”? The songs stay in your library.`)) {
          await this.h.library.deletePlaylist(p.id);
          this.openPlaylist = null;
          await this.refresh();
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------- row menu

  openMenu(btn, row) {
    this.closeMenu();
    const id = row.dataset.id, kind = row.dataset.kind, index = Number(row.dataset.index);
    const song = this.byId.get(id);
    const m = document.createElement('div');
    m.className = 'menu row-menu';
    m.setAttribute('role', 'menu');
    const items = [];
    if (kind !== 'queue' || index !== this.h.queue.pos) items.push(['play-next', 'Play Next'], ['add-queue', 'Add to Queue']);
    items.push(['add-playlist', 'Add to Playlist…']);
    if (kind === 'queue' && index !== this.h.queue.pos) items.push(['remove-queue', 'Remove from Queue']);
    if (kind === 'playlist') items.push(['remove-playlist', 'Remove from Playlist']);
    if (song?.path) items.push(['show', 'Show in Folder']);
    if (song && !song.path) items.push(['forget', 'Forget Song']);
    m.innerHTML = items.map(([a, t]) => `<button role="menuitem" data-menu="${a}">${t}</button>`).join('');
    this.sheet.appendChild(m);
    const r = btn.getBoundingClientRect(), sr = this.sheet.getBoundingClientRect();
    m.style.top = `${Math.min(r.bottom - sr.top + 4, sr.height - m.offsetHeight - 12)}px`;
    m.style.right = `${sr.right - r.right}px`;
    this.menu = m;
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-menu]');
      if (!b) return;
      const a = b.dataset.menu;
      if (a === 'add-playlist') { this.playlistMenu(id); return; }
      this.closeMenu();
      const q = this.h.queue;
      if (a === 'play-next') { q.playNext(id); this.h.toast('Playing next'); }
      else if (a === 'add-queue') { q.add(id); this.h.toast('Added to the queue'); }
      else if (a === 'remove-queue') q.remove(index);
      else if (a === 'remove-playlist') {
        const p = this.playlists.find((x) => x.id === this.openPlaylist);
        if (p) { p.songs.splice(index, 1); await this.h.library.savePlaylist(p); await this.refresh(); }
      } else if (a === 'show') this.h.showInFolder(song.path);
      else if (a === 'forget') {
        if (await this.confirm(`Forget “${song.title || song.audioName}”? It's removed from this app's library.`)) { await this.h.forget(id); await this.refresh(); }
      }
    });
  }

  playlistMenu(id) {
    const m = this.menu;
    m.innerHTML = `<div class="menu-label">Add to Playlist</div>${this.playlists.map((p) => `<button role="menuitem" data-pl="${esc(p.id)}">${esc(p.name)}</button>`).join('')}<button role="menuitem" data-pl="__new">New Playlist…</button>`;
    m.onclick = async (e) => {
      const b = e.target.closest('[data-pl]');
      if (!b) return;
      e.stopPropagation();
      this.closeMenu();
      let p;
      if (b.dataset.pl === '__new') {
        const name = await this.ask('New playlist', 'Playlist name');
        if (!name) return;
        p = { id: `pl-${Date.now().toString(36)}`, name, songs: [] };
      } else p = this.playlists.find((x) => x.id === b.dataset.pl);
      if (!p) return;
      if (!p.songs.includes(id)) p.songs.push(id);
      await this.h.library.savePlaylist(p);
      await this.refresh();
      this.h.toast(`Added to ${p.name}`);
    };
  }

  closeMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  // -------------------------------------------------------- drag to order

  bindDrag() {
    let from = null, list = null;
    this.body.addEventListener('dragstart', (e) => {
      const row = e.target.closest('.lr[draggable="true"]');
      if (!row) return;
      from = Number(row.dataset.index);
      list = row.dataset.kind;
      row.classList.add('dragging-row');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.id);
    });
    this.body.addEventListener('dragover', (e) => {
      const row = e.target.closest('.lr[draggable="true"]');
      if (!row || row.dataset.kind !== list) return;
      e.preventDefault();
      for (const r of this.body.querySelectorAll('.drop-above, .drop-below')) r.classList.remove('drop-above', 'drop-below');
      const r = row.getBoundingClientRect();
      row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
    });
    this.body.addEventListener('dragend', () => {
      for (const r of this.body.querySelectorAll('.dragging-row, .drop-above, .drop-below')) r.classList.remove('dragging-row', 'drop-above', 'drop-below');
    });
    this.body.addEventListener('drop', async (e) => {
      const row = e.target.closest('.lr[draggable="true"]');
      if (!row || from == null || row.dataset.kind !== list) return;
      e.preventDefault();
      e.stopPropagation(); // not a file drop on the player
      const r = row.getBoundingClientRect();
      let to = Number(row.dataset.index) + (e.clientY < r.top + r.height / 2 ? 0 : 1);
      if (to > from) to -= 1;
      if (list === 'queue') this.h.queue.move(from, to);
      else if (list === 'playlist') {
        const p = this.playlists.find((x) => x.id === this.openPlaylist);
        if (p) {
          const [x] = p.songs.splice(from, 1);
          p.songs.splice(to, 0, x);
          await this.h.library.savePlaylist(p);
          await this.refresh();
        }
      }
      from = null;
    });
  }

  // -------------------------------------------------------------- dialogs

  ask(title, placeholder, value = '') {
    return new Promise((resolve) => {
      const d = document.createElement('form');
      d.className = 'ask';
      d.innerHTML = `<div class="ask-title">${esc(title)}</div><input class="set-input" maxlength="80" placeholder="${esc(placeholder)}" value="${esc(value)}"><div class="ask-buttons"><button type="button" class="pill pill-small pill-ghost" data-no>Cancel</button><button type="submit" class="pill pill-small">OK</button></div>`;
      this.sheet.appendChild(d);
      const input = d.querySelector('input');
      input.focus();
      input.select();
      const done = (v) => { d.remove(); resolve(v); };
      d.addEventListener('submit', (e) => { e.preventDefault(); done(input.value.trim() || null); });
      d.querySelector('[data-no]').addEventListener('click', () => done(null));
      d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    });
  }

  confirm(text) {
    return new Promise((resolve) => {
      const d = document.createElement('div');
      d.className = 'ask';
      d.innerHTML = `<div class="ask-title">${esc(text)}</div><div class="ask-buttons"><button type="button" class="pill pill-small pill-ghost" data-no>Cancel</button><button type="button" class="pill pill-small danger" data-yes>OK</button></div>`;
      this.sheet.appendChild(d);
      d.querySelector('[data-yes]').focus();
      d.querySelector('[data-no]').addEventListener('click', () => { d.remove(); resolve(false); });
      d.querySelector('[data-yes]').addEventListener('click', () => { d.remove(); resolve(true); });
    });
  }
}
