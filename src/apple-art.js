// Album covers from Apple Music, including the animated ("motion") covers.
//
// - Albums are found with the public iTunes Search API (free, no key, CORS ok).
// - Animated covers are HLS video streams on mvod.itunes.apple.com. Apple lists
//   them on the album's public web page (music.apple.com/…/album/<id>), the
//   same page anyone can open in a browser. That page doesn't allow cross-site
//   requests, so it is read through a relay that only fetches album pages and
//   only returns the cover video links:
//   - desktop app: the Electron main process (window.lyricPlayerNative)
//   - website: the Vercel function in api/apple-art.js
//   The video streams themselves allow cross-site playback.

import { fold } from './lyrics-search.js';

const SEARCH = 'https://itunes.apple.com/search';

/** iTunes artwork URL → the same image at `size` px. */
export const artworkAt = (url, size = 1000) => (url ? url.replace(/\/\d+x\d+(bb)?(-\d+)?\.(jpg|png|webp)$/i, `/${size}x${size}bb.jpg`) : null);

/**
 * Searches Apple's catalogue by song and returns one entry per album:
 * [{ collectionId, album, artist, year, artwork (1000 px), thumb, storefront }]
 */
export async function searchAlbums(query, { limit = 25, storefront = 'us' } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `${SEARCH}?term=${encodeURIComponent(q)}&entity=song&limit=${limit}&country=${storefront}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Apple search HTTP ${r.status}`);
  const data = await r.json();
  const seen = new Set();
  const out = [];
  for (const s of data.results || []) {
    if (!s.collectionId || seen.has(s.collectionId)) continue;
    seen.add(s.collectionId);
    out.push({
      collectionId: s.collectionId,
      album: s.collectionName || '',
      song: s.trackName || '',
      artist: s.artistName || '',
      year: (s.releaseDate || '').slice(0, 4),
      artwork: artworkAt(s.artworkUrl100, 1000),
      thumb: artworkAt(s.artworkUrl100, 120),
      storefront,
    });
  }
  return out;
}

// Title without "(feat. …)", "[Remastered]", " - Single" and the like.
const core = (s) => fold(String(s || '').replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''));
const words = (s) => core(s).split(/\s+/).filter(Boolean);

/** 0…1: how well an Apple result matches the song we're playing. */
export function albumMatch(r, { title, artist = '', album = '' }) {
  const t = core(title), rt = core(r.song);
  if (!t || !rt) return 0;
  let score = t === rt ? 0.7 : (rt.includes(t) || t.includes(rt)) ? 0.5 : 0;
  if (!score) return 0;
  const aw = words(artist);
  if (aw.length) {
    const ra = ` ${fold(r.artist)} `;
    const hit = aw.filter((w) => ra.includes(` ${w}`)).length / aw.length;
    if (hit < 0.5) return 0;
    score += 0.25 * hit;
  }
  if (album && core(album) === core(r.album)) score += 0.1;
  if (/ - single$|\bep\b|deluxe|remaster|live/i.test(r.album) && !album) score -= 0.03; // prefer the original album
  return Math.min(1, score);
}

/** Best album for a song we know the title (and maybe artist/album) of, or null. */
export async function findAlbum(song) {
  if (!song?.title) return null;
  const results = await searchAlbums([core(song.title), song.artist].filter(Boolean).join(' '), { limit: 15 });
  let best = null, bestScore = 0;
  for (const r of results) {
    const score = albumMatch(r, song);
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return bestScore >= 0.7 ? best : null;
}

// ---------------------------------------------------------------------------
// Animated covers (via the relay)

const motionCache = new Map();

async function relay(collectionId, storefront) {
  const native = typeof window !== 'undefined' ? window.lyricPlayerNative : null;
  if (native?.appleArt) return native.appleArt(String(collectionId), storefront);
  let r;
  try {
    r = await fetch(`api/apple-art?id=${encodeURIComponent(collectionId)}&sf=${encodeURIComponent(storefront)}`);
  } catch (e) {
    throw new Error(`relay unreachable (${e.message})`);
  }
  const type = r.headers.get('content-type') || '';
  if (r.status === 404 && !type.includes('json')) throw new Error('animated covers need the desktop app or the deployed site');
  if (!type.includes('json')) throw new Error('animated covers need the desktop app or the deployed site');
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

/** { square, tall } HLS URLs for an album's animated cover (either may be null). */
export async function fetchMotionArt(collectionId, storefront = 'us') {
  const key = `${storefront}:${collectionId}`;
  if (!motionCache.has(key)) {
    const p = relay(collectionId, storefront).catch((e) => { motionCache.delete(key); throw e; });
    motionCache.set(key, p);
  }
  return motionCache.get(key);
}

// ---------------------------------------------------------------------------
// Relay side (Electron main process and api/apple-art.js)

/** Album page URL for an allowed request, or throws. */
export function appleAlbumPageUrl(id, storefront = 'us') {
  const cid = String(id || '');
  if (!/^\d{1,15}$/.test(cid)) throw new Error('bad id');
  const sf = String(storefront || 'us').toLowerCase();
  if (!/^[a-z]{2}$/.test(sf)) throw new Error('bad storefront');
  return `https://music.apple.com/${sf}/album/${cid}`;
}

const MOTION_URL = /^https:\/\/mvod\.itunes\.apple\.com\/[\w\-./]+\.m3u8$/;

/**
 * Album page HTML → { square, tall }. The page's data lists each cover video as
 * "motionDetailSquare": { "previewFrame": {…}, "video": "https://mvod…m3u8" }.
 */
export function extractMotionArt(html) {
  const out = { square: null, tall: null };
  const text = String(html || '');
  for (const m of text.matchAll(/"video":"(https:\/\/mvod\.itunes\.apple\.com\/[^"]+?\.m3u8)"/g)) {
    const url = m[1].replace(/\\u002F/gi, '/');
    if (!MOTION_URL.test(url)) continue;
    const before = text.slice(Math.max(0, m.index - 2000), m.index);
    const keys = [...before.matchAll(/"(motion\w*)":\{/g)];
    const key = (keys.at(-1)?.[1] || '').toLowerCase();
    if (/square|1x1/.test(key)) out.square ??= url;
    else if (/tall|3x4|portrait/.test(key)) out.tall ??= url;
    else out.square ??= url;
  }
  // Fallback: the page's own <amp-ambient-video src="…"> (the square cover).
  if (!out.square) {
    const v = /<amp-ambient-video[^>]*\ssrc="(https:\/\/mvod\.itunes\.apple\.com\/[^"]+?\.m3u8)"/.exec(text);
    if (v && MOTION_URL.test(v[1])) out.square = v[1];
  }
  return out;
}

export const RELAY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Master HLS playlist → URL of its smallest H.264 variant (for making small
 * GIFs; H.264 decodes everywhere, unlike the HEVC variants).
 */
export function smallestVariant(m3u8, base) {
  const lines = String(m3u8 || '').split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXT-X-STREAM-INF:(.*)$/.exec(lines[i]);
    if (!m) continue;
    const codecs = /CODECS="([^"]*)"/.exec(m[1])?.[1] || '';
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(m[1]);
    const uri = (lines[i + 1] || '').trim();
    if (!uri || uri.startsWith('#') || !/avc1/.test(codecs)) continue;
    const w = res ? Number(res[1]) : Infinity;
    if (!best || w < best.w) best = { w, url: new URL(uri, base).href };
  }
  return best?.url || null;
}
