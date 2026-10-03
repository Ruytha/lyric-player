// Remembers songs between visits: the audio file, its TTML, metadata and a
// small artwork thumbnail, stored in IndexedDB in this browser only.
//
// Record: { id, audioName, audio: Blob, ttmlName, ttml: string, art: Blob|null,
//           thumb: dataURL|null, title, artist, lastPlayed }
// Songs from music folders (desktop app) have `path` instead of `audio`.
// Playlists: { id, name, songs: [song id], created }

const DB = 'lyricplayer';
const STORE = 'songs';
const PLAYLISTS = 'playlists';
const MAX_SONGS = 30; // songs stored inside the browser (folder songs don't count)

/** Stable id for an audio file: same file picked again → same id. */
export const songId = (file) => `${file.name}|${file.size}`;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class Library {
  constructor() {
    this.db = null;
    this.ready = this.open().catch(() => null);
  }

  async open() {
    if (!('indexedDB' in window)) return null;
    const open = indexedDB.open(DB, 2);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!open.result.objectStoreNames.contains(PLAYLISTS)) open.result.createObjectStore(PLAYLISTS, { keyPath: 'id' });
    };
    this.db = await req(open);
    // Ask the browser not to evict the stored songs under storage pressure.
    navigator.storage?.persist?.().catch(() => {});
    return this.db;
  }

  async tx(mode, fn, store = STORE) {
    const db = await this.ready;
    if (!db) throw new Error('Storage unavailable');
    const t = db.transaction(store, mode);
    const result = await fn(t.objectStore(store));
    await new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
    return result;
  }

  get(id) {
    return this.tx('readonly', (s) => req(s.get(id)));
  }

  /** Newest first. Without the audio blobs, so it stays cheap. */
  async list() {
    const all = await this.tx('readonly', (s) => req(s.getAll()));
    return all
      .sort((a, b) => b.lastPlayed - a.lastPlayed)
      .map(({ audio, art, ttml, ...rest }) => ({ ...rest, hasLyrics: !!(ttml || rest.ttmlPath), stored: !!audio }));
  }

  /** Create or merge fields into a song. */
  async update(id, fields) {
    await this.tx('readwrite', async (s) => {
      const cur = (await req(s.get(id))) || { id, lastPlayed: Date.now() };
      s.put({ ...cur, ...fields });
    });
    if (fields.audio) await this.trim();
  }

  /** Merge fields into many songs in one transaction: [[id, fields], …]. */
  async updateMany(entries) {
    if (!entries.length) return;
    await this.tx('readwrite', async (s) => {
      for (const [id, fields] of entries) {
        const cur = (await req(s.get(id))) || { id, lastPlayed: 0 };
        s.put({ ...cur, ...fields });
      }
    });
  }

  remove(id) {
    return this.tx('readwrite', (s) => req(s.delete(id)));
  }

  async removeMany(ids) {
    if (!ids.length) return;
    await this.tx('readwrite', async (s) => { for (const id of ids) s.delete(id); });
  }

  async trim() {
    const songs = (await this.list()).filter((s) => s.stored);
    for (const s of songs.slice(MAX_SONGS)) await this.remove(s.id);
  }

  // Playlists

  async playlists() {
    const all = await this.tx('readonly', (s) => req(s.getAll()), PLAYLISTS);
    return all.sort((a, b) => a.created - b.created);
  }

  savePlaylist(p) {
    return this.tx('readwrite', (s) => req(s.put({ songs: [], created: Date.now(), ...p })), PLAYLISTS);
  }

  deletePlaylist(id) {
    return this.tx('readwrite', (s) => req(s.delete(id)), PLAYLISTS);
  }
}

/** Small square JPEG of an image URL, for the library list. */
export async function makeThumb(url, size = 96) {
  const img = new Image();
  img.crossOrigin = 'anonymous'; // online covers (mzstatic) allow it
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.8);
}
