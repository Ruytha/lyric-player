// Apple Music catalogue search for "Search Apple Music…": songs from the
// public iTunes Search API (free, no key, CORS ok), with Apple's own 30-second
// previews, links to the song in Apple Music and in the iTunes Store, and the
// price there. Nothing here downloads songs.

import { artworkAt } from './apple-art.js';

const SEARCH = 'https://itunes.apple.com/search';

/** The store to search: the region in the browser's language ("en-AU" → "au"), else "us". */
export function guessStorefront(langs = (typeof navigator !== 'undefined' && navigator.languages) || []) {
  for (const l of langs) {
    const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(l || '');
    if (m) return m[1].toLowerCase();
  }
  return 'us';
}

/** 1.29, "USD" → "$1.29" in the reader's locale; null when the song isn't for sale. */
export function formatPrice(price, currency, locale) {
  if (!(Number(price) > 0) || !currency) return null;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

/** Adds a query parameter to an Apple link (keeps the ?i=<song> it already has). */
function withParam(url, key, value) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.href;
  } catch {
    return url;
  }
}

/** One iTunes Search API song result → what the search window shows. */
export function toSong(s, storefront = 'us') {
  const view = s.trackViewUrl || '';
  return {
    id: s.trackId,
    collectionId: s.collectionId || null,
    title: s.trackName || '',
    artist: s.artistName || '',
    album: s.collectionName || '',
    year: (s.releaseDate || '').slice(0, 4),
    genre: s.primaryGenreName || '',
    duration: s.trackTimeMillis ? s.trackTimeMillis / 1000 : 0,
    explicit: s.trackExplicitness === 'explicit',
    thumb: artworkAt(s.artworkUrl100, 120),
    artwork: artworkAt(s.artworkUrl100, 600),
    preview: s.previewUrl || null,
    appleMusicUrl: view ? withParam(view, 'app', 'music') : null,
    storeUrl: view ? withParam(view, 'app', 'itunes') : null,
    price: formatPrice(s.trackPrice, s.currency),
    storefront,
  };
}

/** Searches songs. Returns [{ id, title, artist, album, … }] (see toSong). */
export async function searchCatalog(query, { limit = 40, storefront = guessStorefront() } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `${SEARCH}?term=${encodeURIComponent(q)}&entity=song&limit=${limit}&country=${storefront}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Apple search HTTP ${r.status}`);
  const data = await r.json();
  const seen = new Set();
  const out = [];
  for (const s of data.results || []) {
    if (s.kind !== 'song' || !s.trackId || seen.has(s.trackId)) continue;
    seen.add(s.trackId);
    out.push(toSong(s, storefront));
  }
  return out;
}

/** "Artist - Title.ttml", safe as a file name. */
export function ttmlFileName({ title = '', artist = '' }) {
  const name = [artist, title].filter(Boolean).join(' - ') || 'lyrics';
  return `${name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)}.ttml`;
}
