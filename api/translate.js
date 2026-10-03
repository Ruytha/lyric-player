// Vercel serverless function: translates lyric lines for Lyric Player when the
// browser has no translator of its own. Uses DeepL with the site owner's key
// (env DEEPL_KEY; a free key ends in ":fx"). Without a key it says so.
//
//   POST /api/translate  { lines: [string], target: "en" }  →  { lines: [string] }

const MAX_LINES = 300;
const MAX_CHARS = 12000;
const ALLOWED_ORIGINS = /^(app:\/\/player|capacitor:\/\/localhost|https:\/\/localhost|https:\/\/files\.ruytha\.dev|https:\/\/lyricviewer[\w-]*\.vercel\.app|http:\/\/(localhost|127\.0\.0\.\d+)(:\d+)?)$/;
const TARGETS = { en: 'EN-US', pt: 'PT-BR', zh: 'ZH-HANS' };

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
  }
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > MAX_CHARS * 2) break; }
  return JSON.parse(raw || '{}');
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  if (req.headers.origin && !ALLOWED_ORIGINS.test(req.headers.origin)) { res.status(403).json({ error: 'not allowed from this site' }); return; }
  const key = process.env.DEEPL_KEY;
  if (!key) { res.status(501).json({ error: 'translation isn’t set up on this website (no DeepL key)' }); return; }
  let body;
  try { body = await readBody(req); } catch { res.status(400).json({ error: 'bad request' }); return; }
  const lines = Array.isArray(body.lines) ? body.lines.slice(0, MAX_LINES).map((l) => String(l ?? '').slice(0, 500)) : [];
  const target = String(body.target || 'en').toLowerCase().slice(0, 5);
  if (!lines.length || lines.join('').length > MAX_CHARS || !/^[a-z]{2}$/.test(target)) { res.status(400).json({ error: 'too much text or bad language' }); return; }
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  try {
    const r = await fetch(`${host}/v2/translate`, {
      method: 'POST',
      headers: { Authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines, target_lang: TARGETS[target] || target.toUpperCase() }),
    });
    if (r.status === 456) { res.status(503).json({ error: 'the website’s translation allowance is used up for this month' }); return; }
    if (!r.ok) { res.status(502).json({ error: `DeepL HTTP ${r.status}` }); return; }
    const out = await r.json();
    const tr = out.translations || [];
    const same = tr.length && tr.every((t) => (t.detected_source_language || '').toLowerCase().startsWith(target));
    res.status(200).json({ lines: tr.map((t) => t.text), same: !!same });
  } catch (e) {
    res.status(502).json({ error: `DeepL unreachable: ${e.message}` });
  }
}
