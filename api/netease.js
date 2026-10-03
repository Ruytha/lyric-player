// Vercel serverless function: relays NetEase Cloud Music search and lyric
// requests for the website (NetEase doesn't allow cross-site requests).
// Only those two endpoints are forwarded; see neteaseUpstreamUrl.
//
//   GET /api/netease?kind=search&s=<query>&limit=10
//   GET /api/netease?kind=lyric&id=<song id>

import { neteaseUpstreamUrl } from '../src/netease.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  let upstream;
  try {
    const params = Object.fromEntries(new URL(req.url, 'http://local').searchParams);
    upstream = neteaseUpstreamUrl(params.kind, params);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }
  try {
    const r = await fetch(upstream, {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      },
    });
    const body = await r.text();
    res.status(r.ok ? 200 : 502);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    // Lyrics rarely change; let Vercel's CDN keep them for a day.
    res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: `NetEase unreachable: ${e.message}` });
  }
}
