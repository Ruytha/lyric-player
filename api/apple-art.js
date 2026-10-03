// Vercel serverless function: finds an album's animated cover for the website.
// Reads the album's public page on music.apple.com (which doesn't allow
// cross-site requests) and returns only the cover video links.
//
//   GET /api/apple-art?id=<album id>&sf=us  →  { square, tall }

import { appleAlbumPageUrl, extractMotionArt, RELAY_HEADERS } from '../src/apple-art.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  let page;
  try {
    const q = new URL(req.url, 'http://local').searchParams;
    page = appleAlbumPageUrl(q.get('id'), q.get('sf') || 'us');
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }
  try {
    const r = await fetch(page, { headers: RELAY_HEADERS, redirect: 'follow' });
    if (r.status === 404) {
      res.setHeader('cache-control', 'public, s-maxage=86400');
      res.status(200).json({ square: null, tall: null });
      return;
    }
    if (!r.ok) {
      res.status(502).json({ error: `Apple Music HTTP ${r.status}` });
      return;
    }
    // Covers rarely change; let Vercel's CDN keep the answer for a week.
    res.setHeader('cache-control', 'public, s-maxage=604800, stale-while-revalidate=2592000');
    res.status(200).json(extractMotionArt(await r.text()));
  } catch (e) {
    res.status(502).json({ error: `Apple Music unreachable: ${e.message}` });
  }
}
