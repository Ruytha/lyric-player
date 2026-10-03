// BiniLyrics (lyrics.binimum.org/developers): a free lyrics API with TTML in
// Apple Music's format, word- or line-timed. No key; open to any website
// (CORS *). The API redirects to lrc.red, so that's called directly.

import { scoreMatch } from './lyrics-search.js';

const API = 'https://lrc.red/api/v1';
const FILES = /^https:\/\/lrc\.red\//; // only fetch lyric files from the API's own host

const toResult = (x) => ({
  source: 'bini',
  id: x.id,
  title: x.track_name || '',
  artists: String(x.artist_name || '').split(/\s*,\s*|\s+&\s+/).filter(Boolean),
  album: x.album_name || '',
  duration: x.duration || 0,
  isrc: x.isrc || null,
  url: x.lyricsUrl,
  wordSync: x.timing_type === 'word',
  synced: x.timing_type === 'word' || x.timing_type === 'line',
});

async function get(params) {
  const r = await fetch(`${API}?${new URLSearchParams(params)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return (j.results || []).filter((x) => x.lyricsUrl && FILES.test(x.lyricsUrl) && x.timing_type !== 'none').map(toResult);
}

/** Free-text search; the API doesn't rank, so results are ranked here. */
export async function searchBini(query, limit = 15) {
  const list = await get({ q: query });
  return list
    .map((r) => [scoreMatch(query, r), r])
    .filter(([s]) => s > 0)
    .sort((a, b) => b[0] - a[0] || b[1].wordSync - a[1].wordSync)
    .slice(0, limit)
    .map(([, r]) => r);
}

/** Exact lookup by title + artist (+ length in seconds). */
export function lookupBini({ title, artist, duration }) {
  const params = { track: title, artist };
  if (duration > 0) params.duration = String(Math.round(duration));
  return get(params);
}

export async function fetchBiniTtml(result) {
  if (!FILES.test(result.url || '')) throw new Error('unexpected lyrics address');
  const r = await fetch(result.url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
