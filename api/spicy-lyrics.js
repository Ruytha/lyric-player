// Vercel serverless function: lyrics from Spicy Lyrics for the player.
//
// The Spicy Lyrics API needs a secret key that must stay on a server
// (env SPICY_LYRICS_KEY, from developers.spicylyrics.org). It looks songs up
// by Spotify track ID, so the song is first found with Spotify's search
// (env SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET, a free app from
// developer.spotify.com; client credentials, no user sign-in). The answer goes
// back as TTML with Spicy Lyrics' credit inside, only to Lyric Player itself.
//
//   GET /api/spicy-lyrics?title=&artist=&duration=   (or ?q=…, or ?spotifyId=…)
//   → { found, spotifyId, title, artists, album, duration, type, ttml }

import { spicyToTtml } from '../src/spicy-lyrics.js';

// Lyric Player's own pages: the website, the desktop app, the iPhone app.
const ORIGINS = new Set(['https://files.ruytha.dev', 'app://player', 'capacitor://localhost', 'http://localhost:5173']);
const UA = 'LyricPlayer/2 (+https://files.ruytha.dev/download/lyricviewer)';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\s*[([].*?[)\]]/g, '').replace(/[’'`"]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Best Spotify track for title / artist (and length, when known), or null. */
export function pickTrack(results, { title = '', artist = '', duration = 0, q = '' }) {
  let best = null, bestScore = 0;
  for (const r of results) {
    if (!r?.id) continue;
    const name = r.name || '', artists = (r.artists || []).map((a) => a.name).join(' ');
    let score = 1;
    if (title) {
      const t = fold(title), rt = fold(name);
      if (t === rt) score += 10; else if (rt.startsWith(t) || t.startsWith(rt)) score += 5; else continue;
      if (name.trim().toLowerCase() === title.trim().toLowerCase()) score += 1; // exactly the same version (e.g. with or without a feature)
      if (artist) {
        const a = fold(artist).split(' ').filter(Boolean), ra = ` ${fold(artists)} `;
        const hit = a.filter((w) => ra.includes(` ${w}`)).length / (a.length || 1);
        if (!hit) continue;
        score += 4 * hit;
      }
    } else if (!q) continue;
    if (duration > 0 && r.duration_ms) {
      const d = Math.abs(duration - r.duration_ms / 1000);
      if (d > 12) continue;
      score += d < 3 ? 3 : 1;
    }
    if (score > bestScore) { best = r; bestScore = score; }
  }
  return best;
}

// Spotify app token (client credentials), reused until it expires.
let spotifyToken = null;
async function spotify(path) {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw Object.assign(new Error('Spotify search isn’t set up on this website (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET)'), { status: 501 });
  if (!spotifyToken || spotifyToken.until < Date.now() + 30000) {
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(9000),
    });
    const t = await r.json().catch(() => null);
    if (!r.ok || !t?.access_token) throw Object.assign(new Error('Spotify refused the app keys'), { status: 502 });
    spotifyToken = { value: t.access_token, until: Date.now() + (t.expires_in || 3600) * 1000 };
  }
  return getJson(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${spotifyToken.value}` } });
}

async function getJson(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(9000) });
  const text = await r.text().catch(() => '');
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body, text: body ? undefined : text.slice(0, 160) };
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ORIGINS.has(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  // Only for Lyric Player: browsers send an Origin on cross-site requests;
  // a page of another site gets no answer.
  if (origin && !ORIGINS.has(origin)) { res.status(403).json({ error: 'not allowed' }); return; }
  const key = process.env.SPICY_LYRICS_KEY;
  if (!key) { res.status(501).json({ error: 'Spicy Lyrics isn’t set up on this website (SPICY_LYRICS_KEY)' }); return; }

  const p = new URL(req.url, 'http://local').searchParams;
  const title = (p.get('title') || '').slice(0, 200).trim();
  const artist = (p.get('artist') || '').slice(0, 200).trim();
  const q = (p.get('q') || '').slice(0, 200).trim();
  const duration = Math.max(0, Math.min(3600, Number(p.get('duration')) || 0));
  let spotifyId = /^[A-Za-z0-9]{22}$/.test(p.get('spotifyId') || '') ? p.get('spotifyId') : null;
  if (!spotifyId && !title && !q) { res.status(400).json({ error: 'missing title or q' }); return; }

  try {
    let song = { title, artists: artist ? [artist] : [], album: '', duration };
    if (!spotifyId) {
      // 1. The song on Spotify (field search first, then plain words)
      const clean = (s) => s.replace(/["()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
      const tries = title ? [`track:${clean(title)}${artist ? ` artist:${clean(artist)}` : ''}`, `${clean(title)} ${clean(artist)}`] : [q];
      let hit = null, busy = false;
      const looked = [];
      for (const term of tries) {
        const sr = await spotify(`search?${new URLSearchParams({ q: term, type: 'track', limit: '10' })}`);
        looked.push(`${sr.status}:${sr.body?.tracks?.items?.length ?? (sr.body?.error?.message || sr.text || 'no results')}`);
        if (sr.status === 429) { busy = true; break; }
        hit = pickTrack(sr.body?.tracks?.items || [], { title, artist, duration, q });
        if (hit) break;
      }
      if (busy) { res.status(503).json({ error: 'Spotify is busy; try again in a minute' }); return; }
      if (!hit) { res.setHeader('cache-control', 'public, s-maxage=3600'); res.status(200).json({ found: false, reason: 'song not found on Spotify', searched: looked }); return; }
      spotifyId = hit.id;
      song = { title: hit.name, artists: (hit.artists || []).map((a) => a.name), album: hit.album?.name || '', duration: (hit.duration_ms || 0) / 1000 };
    }
    // 2. Spicy Lyrics
    const sp = await getJson(`https://api.spicylyrics.org/v1/lyrics/${spotifyId}`, { headers: { Authorization: `Bearer ${key}` } });
    if (sp.status === 404) { res.setHeader('cache-control', 'public, s-maxage=3600'); res.status(200).json({ found: false, spotifyId, reason: 'no lyrics on Spicy Lyrics' }); return; }
    if (sp.status === 401 || sp.status === 403) { res.status(502).json({ error: 'Spicy Lyrics refused the key' }); return; }
    if (sp.status === 429) { res.status(503).json({ error: 'Spicy Lyrics is busy; try again later' }); return; }
    if (sp.status >= 400 || !sp.body) { res.status(502).json({ error: `Spicy Lyrics HTTP ${sp.status}` }); return; }
    const body = sp.body.Body || sp.body;
    const ttml = spicyToTtml(sp.body, { title: song.title, artists: song.artists });
    // Kept by the CDN for a day (well inside the 30 days Spicy Lyrics allows).
    res.setHeader('cache-control', 'public, s-maxage=86400, max-age=0');
    res.status(200).json({ found: true, spotifyId, ...song, type: body.Type, ttml });
  } catch (e) {
    res.status(e.status || 502).json({ error: String(e.message || e).slice(0, 200) });
  }
}
