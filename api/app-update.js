// Vercel serverless function: the desktop app's in-app updates.
// Lists every player file with its SHA-256, plus the version (root
// package.json) and the oldest desktop app it works with (lyricPlayer.minApp).
// The app downloads changed files from this same site (desktop/web-update.cjs).
//
//   GET /api/app-update  →  { version, minApp, files: { "src/main.js": "<sha256>", … } }

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const TOP = ['index.html', 'styles.css', 'apple-ui.css', 'mini.html', 'package.json'];
const DIRS = ['src', 'examples'];
const EXT = /\.(js|mjs|css|json|ttml|wasm|svg|png)$/;

let cached = null;

async function walk(root, dir, out) {
  for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) await walk(root, rel, out);
    else if (EXT.test(e.name)) out.push(rel);
  }
}

export async function buildManifest(root = process.cwd()) {
  const list = [...TOP];
  for (const d of DIRS) await walk(root, d, list).catch(() => {});
  const files = {};
  for (const p of list.sort()) {
    const data = await readFile(path.join(root, p)).catch(() => null);
    if (data) files[p] = createHash('sha256').update(data).digest('hex');
  }
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  return { version: pkg.version, minApp: pkg.lyricPlayer?.minApp || '0.0.0', files };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  // Vercel doesn't serve package.json as a file, so it's handed out here
  // (vercel.json routes /update/lyricviewer/package.json to ?file=package.json).
  if (new URL(req.url, 'http://local').searchParams.get('file') === 'package.json') {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.status(200).send(await readFile(path.join(process.cwd(), 'package.json')));
    return;
  }
  try {
    cached ??= await buildManifest();
    res.setHeader('cache-control', 'no-store');
    res.status(200).json(cached);
  } catch (e) {
    cached = null;
    res.status(500).json({ error: e.message });
  }
}
