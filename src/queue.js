// Play queue: the order songs play in, shuffle and repeat. Pure logic (song
// ids only); main.js does the playing. Saved in localStorage.

const KEY = 'lyricplayer:queue';

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Smart shuffle: songs heard recently go later (weighted random order), and
 * the same artist doesn't play twice in a row when it can be avoided.
 * info(id) → { artist, lastPlayed }.
 */
export function smartShuffled(list, info, { now = Date.now(), rand = Math.random } = {}) {
  const DAY = 86400000;
  const keyed = list.map((id) => {
    const i = info(id) || {};
    const ago = i.lastPlayed ? Math.max(0, now - i.lastPlayed) / DAY : 30;
    const weight = 0.15 + Math.min(1, ago / 7); // played today ≈ 0.15, a week ago or more = 1.15
    return { id, artist: String(i.artist || '').toLowerCase().split(/\s*(?:,|&| feat)/)[0], key: rand() ** (1 / weight) };
  }).sort((a, b) => b.key - a.key);
  const out = [];
  while (keyed.length) {
    const prev = out.at(-1)?.artist;
    let j = keyed.findIndex((x) => !prev || !x.artist || x.artist !== prev);
    if (j < 0 || j > 6) j = 0; // don't push a song too far just for variety
    out.push(keyed.splice(j, 1)[0]);
  }
  return out.map((x) => x.id);
}

export class Queue {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
    this.items = [];
    this.pos = -1;
    this.shuffle = false;
    this.repeat = 'off';       // off | all | one
    this.original = null;      // order before shuffling
    this.listeners = new Set();
    this.smart = null;         // info(id) for smart shuffle, or null for plain
    try {
      const s = JSON.parse(this.storage?.getItem(KEY) || 'null');
      if (s && Array.isArray(s.items)) {
        this.items = s.items.filter((x) => typeof x === 'string');
        this.pos = Math.min(Math.max(-1, s.pos | 0), this.items.length - 1);
        this.shuffle = !!s.shuffle;
        this.repeat = ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : 'off';
        this.original = Array.isArray(s.original) ? s.original : null;
      }
    } catch { /* storage unavailable */ }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  changed() {
    try {
      this.storage?.setItem(KEY, JSON.stringify({ items: this.items, pos: this.pos, shuffle: this.shuffle, repeat: this.repeat, original: this.original }));
    } catch { /* storage unavailable */ }
    for (const fn of this.listeners) fn(this);
  }

  get current() { return this.items[this.pos] ?? null; }
  get upcoming() { return this.items.slice(this.pos + 1); }

  /** Play `ids` (e.g. the visible song list) starting at `startId`. */
  set(ids, startId = ids[0]) {
    const list = [...new Set(ids)];
    this.original = list.slice();
    if (this.shuffle) {
      const rest = this.mix(list.filter((x) => x !== startId));
      this.items = startId != null && list.includes(startId) ? [startId, ...rest] : rest;
      this.pos = 0;
    } else {
      this.items = list;
      this.pos = Math.max(0, list.indexOf(startId));
    }
    this.changed();
    return this.current;
  }

  /** Makes `id` the current song without changing the rest (e.g. opened from elsewhere). */
  touch(id) {
    if (this.current === id) return;
    const i = this.items.indexOf(id);
    if (i >= 0) this.pos = i;
    else { this.items.splice(this.pos + 1, 0, id); this.pos += 1; this.original?.push(id); }
    this.changed();
  }

  /** Next song id, or null at the end. auto: called because the song ended. */
  next({ auto = false } = {}) {
    if (!this.items.length) return null;
    if (auto && this.repeat === 'one') return this.current;
    if (this.pos + 1 < this.items.length) this.pos += 1;
    else if (this.repeat !== 'off') { // repeat all, or skipping past the end with repeat one
      this.pos = 0;
      if (this.shuffle) {
        // New random order for the next round, not starting with the song just played.
        const last = this.items[this.items.length - 1];
        this.items = this.mix(this.items);
        if (this.items.length > 1 && this.items[0] === last) this.items.push(this.items.shift());
      }
    } else return null;
    this.changed();
    return this.current;
  }

  prev() {
    if (!this.items.length) return null;
    if (this.pos > 0) this.pos -= 1;
    else if (this.repeat !== 'off') this.pos = this.items.length - 1;
    else return null;
    this.changed();
    return this.current;
  }

  jump(index) {
    if (index < 0 || index >= this.items.length) return null;
    this.pos = index;
    this.changed();
    return this.current;
  }

  playNext(id) {
    this.removeId(id, { keepCurrent: true });
    this.items.splice(this.pos + 1, 0, id);
    if (this.pos < 0) this.pos = 0;
    this.changed();
  }

  add(id) {
    this.removeId(id, { keepCurrent: true });
    this.items.push(id);
    if (this.pos < 0) this.pos = 0;
    this.changed();
  }

  removeId(id, { keepCurrent = false } = {}) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i] !== id || (keepCurrent && i === this.pos)) continue;
      this.items.splice(i, 1);
      if (i < this.pos) this.pos -= 1;
    }
  }

  /** Removes the song at queue index i (not the current one). */
  remove(i) {
    if (i === this.pos || i < 0 || i >= this.items.length) return;
    this.items.splice(i, 1);
    if (i < this.pos) this.pos -= 1;
    this.changed();
  }

  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.items.length || to >= this.items.length) return;
    const cur = this.current;
    const [x] = this.items.splice(from, 1);
    this.items.splice(to, 0, x);
    this.pos = this.items.indexOf(cur);
    this.changed();
  }

  clearUpcoming() {
    this.items = this.items.slice(0, this.pos + 1);
    this.changed();
  }

  /** Forget ids that no longer exist in the library. */
  prune(valid) {
    const cur = this.current;
    this.items = this.items.filter((x) => valid.has(x));
    this.pos = cur && this.items.includes(cur) ? this.items.indexOf(cur) : Math.min(this.pos, this.items.length - 1);
    this.changed();
  }

  setShuffle(on) {
    if (on === this.shuffle) return;
    this.shuffle = on;
    const cur = this.current;
    if (on) {
      this.original = this.items.slice();
      const rest = this.mix(this.items.filter((_, i) => i !== this.pos));
      this.items = cur != null ? [cur, ...rest] : rest;
      this.pos = cur != null ? 0 : -1;
    } else if (this.original) {
      const known = new Set(this.items);
      this.items = [...this.original.filter((x) => known.has(x)), ...this.items.filter((x) => !this.original.includes(x))];
      this.pos = cur != null ? this.items.indexOf(cur) : -1;
    }
    this.changed();
  }

  mix(list) { return this.smart ? smartShuffled(list, this.smart) : shuffled(list); }

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    this.changed();
    return this.repeat;
  }
}
