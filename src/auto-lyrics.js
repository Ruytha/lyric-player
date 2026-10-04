// Automatic lyrics: search every source for the song that's playing and pick
// the best match (right title and artist, close in length, word-synced first).

import { fold } from './lyrics-search.js';

const core = (s) => fold(String(s || '').replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, ''));
const words = (s) => core(s).split(/\s+/).filter(Boolean);

// Better sources first when everything else is equal.
const SOURCE_RANK = { apple: 5, amll: 4, bini: 4, qq: 3, netease: 3, lrclib: 1 };

/** Score of one search result for a song (0 = not a match). */
export function lyricsMatch(r, { title, artist = '', duration = 0 }) {
  const t = core(title), rt = core(r.title);
  if (!t || !rt) return 0;
  let score;
  if (t === rt) score = 10;
  else if (rt.startsWith(t) || t.startsWith(rt)) score = 6;
  else return 0;
  const aw = words(artist);
  if (aw.length) {
    const ra = ` ${fold((r.artists || []).join(' '))} `;
    const hit = aw.filter((w) => ra.includes(` ${w}`)).length / aw.length;
    if (hit === 0 && r.artists?.length) return 0;
    score += 4 * hit;
  }
  if (duration > 0 && r.duration > 0) {
    const d = Math.abs(duration - r.duration);
    if (d > 15) return 0;          // a different version (live, remix, extended)
    score += d < 3 ? 3 : d < 8 ? 1 : 0;
  }
  // Apple Music's synced lyrics are word-synced when the song has them (known only once fetched).
  if (r.source === 'amll' || r.wordSync || (r.source === 'apple' && r.synced)) score += 5;
  else if (r.synced === false) return 0;
  score += SOURCE_RANK[r.source] || 0;
  return score;
}

/** Best result, or null if nothing matches well enough. */
export function pickBestLyrics(results, song) {
  let best = null, bestScore = 0;
  for (const r of results) {
    const s = lyricsMatch(r, song);
    if (s > bestScore) { best = r; bestScore = s; }
  }
  return bestScore >= 12 ? best : null;
}

/** Every good-enough match, best first (ties keep the search order). */
export function rankLyrics(results, song) {
  return results
    .map((r, i) => ({ r, i, s: lyricsMatch(r, song) }))
    .filter((x) => x.s >= 12)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Fetches the best match that actually delivers lyrics: when one source fails
 * (Apple Music signed out, a site down), the next match is tried.
 * Returns { best, ttml } or null when nothing matched; throws the last error.
 */
export async function fetchBestLyrics(results, song, getTtml, onFail = () => {}) {
  let lastError = null;
  for (const r of rankLyrics(results, song)) {
    try {
      const ttml = await getTtml(r);
      if (ttml) return { best: r, ttml };
    } catch (e) { lastError = e; onFail(r, e); }
  }
  if (lastError) throw lastError;
  return null;
}
