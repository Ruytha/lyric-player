// Vercel serverless function: an album's animated cover as a small looping
// GIF, for Discord Rich Presence (Discord shows images from public URLs and
// can't play video). The desktop app points Discord at this URL.
//
//   GET /api/cover-gif?id=<album id>&sf=us  →  image/gif
//
// Uses ffmpeg (ffmpeg-static) on the smallest H.264 variant of the cover's
// HLS stream. Results are cached by Vercel's CDN for a year.

import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { appleAlbumPageUrl, extractMotionArt, smallestVariant, RELAY_HEADERS } from '../src/apple-art.js';

const SECONDS = 6;
const SIZE = 160;

export function gifArgs(input, { seconds = SECONDS, size = SIZE } = {}) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-t', String(seconds), '-i', input,
    '-vf', `fps=10,scale=${size}:${size}:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0', '-f', 'gif', 'pipe:1',
  ];
}

export function makeGif(input, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, gifArgs(input, opts));
    const out = [], err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => {
      const gif = Buffer.concat(out);
      if (code === 0 && gif.length) resolve(gif);
      else reject(new Error(Buffer.concat(err).toString().trim().slice(0, 300) || `ffmpeg exited ${code}`));
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
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
    const { square } = r.ok ? extractMotionArt(await r.text()) : { square: null };
    if (!square) {
      res.setHeader('cache-control', 'public, s-maxage=86400');
      res.status(404).json({ error: 'no animated cover' });
      return;
    }
    const master = await (await fetch(square)).text();
    const variant = smallestVariant(master, square) || square;
    const gif = await makeGif(variant);
    res.setHeader('content-type', 'image/gif');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.status(200).send(gif);
  } catch (e) {
    res.status(502).json({ error: `couldn't make the GIF: ${e.message}` });
  }
}
