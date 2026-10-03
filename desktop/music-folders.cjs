// Music folders: the desktop app can play straight from folders on disk.
//
// - The user picks folders (remembered in <userData>/music-folders.json).
// - Folders are scanned for audio files; tags are read with music-metadata
//   and cached by path + size + modified time, so rescans are quick.
// - Files are served to the page over media://track/?p=<path>, with byte
//   ranges (for seeking). Only files inside the chosen folders are served.
// - Folders are watched; changes are announced to the page.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.wav', '.alac', '.aif', '.aiff', '.wma']);
const TTML_EXT = new Set(['.ttml']);
const MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.wav': 'audio/wav', '.alac': 'audio/mp4', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.wma': 'audio/x-ms-wma',
};
const MAX_FILES = 50000;

class MusicFolders {
  constructor(app) {
    this.file = path.join(app.getPath('userData'), 'music-folders.json');
    this.cacheFile = path.join(app.getPath('userData'), 'tag-cache.json');
    this.folders = [];
    this.cache = {};
    this.watchers = new Map();
    this.onChange = () => {};
    this.mm = null;
    try { this.folders = JSON.parse(fs.readFileSync(this.file, 'utf8')).folders || []; } catch { /* first run */ }
    try { this.cache = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch { /* no cache yet */ }
  }

  save() {
    fs.promises.writeFile(this.file, JSON.stringify({ folders: this.folders }, null, 2)).catch(() => {});
  }

  /** True when `file` is inside one of the chosen folders. */
  allowed(file) {
    const f = path.resolve(file).toLowerCase();
    return this.folders.some((dir) => {
      const d = path.resolve(dir).toLowerCase();
      return f === d || f.startsWith(d.endsWith(path.sep) ? d : d + path.sep);
    });
  }

  add(dir) {
    const d = path.resolve(dir);
    if (!this.folders.some((x) => path.resolve(x).toLowerCase() === d.toLowerCase())) {
      this.folders.push(d);
      this.save();
    }
    this.watch();
  }

  remove(dir) {
    const d = path.resolve(dir).toLowerCase();
    this.folders = this.folders.filter((x) => path.resolve(x).toLowerCase() !== d);
    this.save();
    this.watch();
  }

  watch() {
    for (const [dir, w] of this.watchers) if (!this.folders.includes(dir)) { w.close(); this.watchers.delete(dir); }
    for (const dir of this.folders) {
      if (this.watchers.has(dir)) continue;
      try {
        let timer = null;
        const w = fs.watch(dir, { recursive: true }, (_e, name) => {
          if (name && !AUDIO_EXT.has(path.extname(name).toLowerCase()) && !TTML_EXT.has(path.extname(name).toLowerCase())) return;
          clearTimeout(timer);
          timer = setTimeout(() => this.onChange(), 2500);
        });
        w.on('error', () => { w.close(); this.watchers.delete(dir); });
        this.watchers.set(dir, w);
      } catch { /* folder gone or not watchable */ }
    }
  }

  async walk(dir, out) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.name.startsWith('.') || e.name === '$RECYCLE.BIN' || e.name === 'System Volume Information') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await this.walk(p, out);
      else if (e.isFile() && AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
    }
  }

  async tags(file, { covers = false } = {}) {
    this.mm ??= await import('music-metadata');
    const m = await this.mm.parseFile(file, { skipCovers: !covers, duration: false });
    const c = m.common;
    return {
      title: c.title || null,
      artist: c.artist || (c.artists || []).join(', ') || null,
      album: c.album || null,
      track: c.track?.no || null,
      disc: c.disk?.no || null,
      duration: m.format.duration || null,
      lossless: !!m.format.lossless,
      picture: covers && c.picture?.[0] ? { format: c.picture[0].format, data: c.picture[0].data } : null,
    };
  }

  /** Every audio file in the chosen folders, with tags (cached). */
  async scan() {
    const files = [];
    for (const dir of this.folders) await this.walk(dir, files);
    const out = [];
    const seen = new Set();
    let dirty = false;
    // Tags for a few files at a time.
    for (let i = 0; i < files.length; i += 8) {
      await Promise.all(files.slice(i, i + 8).map(async (file) => {
        let st;
        try { st = await fsp.stat(file); } catch { return; }
        const key = file;
        seen.add(key);
        let c = this.cache[key];
        if (!c || c.size !== st.size || c.mtime !== st.mtimeMs) {
          let tags = {};
          try { tags = await this.tags(file); } catch { /* unreadable tags: use the file name */ }
          c = this.cache[key] = { size: st.size, mtime: st.mtimeMs, tags };
          dirty = true;
        }
        // A .ttml with the same name next to the song is its lyrics.
        const ttml = file.replace(/\.[^.\\/]+$/, '.ttml');
        out.push({ path: file, name: path.basename(file), folder: path.dirname(file), size: st.size, mtime: st.mtimeMs, ttmlPath: fs.existsSync(ttml) ? ttml : null, ...c.tags });
      }));
    }
    for (const k of Object.keys(this.cache)) if (!seen.has(k)) { delete this.cache[k]; dirty = true; }
    if (dirty) fsp.writeFile(this.cacheFile, JSON.stringify(this.cache)).catch(() => {});
    return out;
  }

  /** media://track/?p=… → the file, with Range support. */
  async serve(request) {
    const url = new URL(request.url);
    const file = url.searchParams.get('p') || '';
    if (!file || !this.allowed(file) || !AUDIO_EXT.has(path.extname(file).toLowerCase())) return new Response('Forbidden', { status: 403 });
    let st;
    try { st = await fsp.stat(file); } catch { return new Response('Not found', { status: 404 }); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const base = { 'content-type': type, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
    if (!range) {
      return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'content-length': String(st.size) } });
    }
    let start = range[1] ? Number(range[1]) : NaN, end = range[2] ? Number(range[2]) : st.size - 1;
    if (Number.isNaN(start)) { start = Math.max(0, st.size - end); end = st.size - 1; }
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${st.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { ...base, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${st.size}` },
    });
  }
}

module.exports = { MusicFolders };
