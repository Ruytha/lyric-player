// Vercel serverless function: relays QQ Music search and lyric requests for
// the website (QQ Music doesn't allow cross-site requests). Only those two
// requests are forwarded; see qqUpstreamRequest.
//
//   GET /api/qq-music?kind=search&s=<query>&limit=10
//   GET /api/qq-music?kind=lyric&id=<song id>

import { qqUpstreamRequest, QQ_HEADERS } from '../src/qq-music.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  let upstream;
  try {
    const params = Object.fromEntries(new URL(req.url, 'http://local').searchParams);
    upstream = qqUpstreamRequest(params.kind, params);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }
  try {
    const r = await fetch(upstream.url, { method: 'POST', headers: QQ_HEADERS, body: upstream.body });
    const body = await r.text();
    res.status(r.ok ? 200 : 502);
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.send(body);
  } catch (e) {
    res.status(502).json({ error: `QQ Music unreachable: ${e.message}` });
  }
}
