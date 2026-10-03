// NetEase Cloud Music lyrics: word-synced "YRC" when available, else LRC,
// plus its translation, converted to TTML.
//
// NetEase has no public API and doesn't allow cross-site requests, so calls
// go through a relay that only forwards its search and lyric endpoints:
// - desktop app: the Electron main process (window.lyricPlayerNative)
// - website: the Vercel function in api/netease.js
// This uses NetEase's private API (as AMLL Player and other players do); it
// may change or stop working at any time.

import { lrcToTtml } from './lyrics-search.js';

// ---------------------------------------------------------------------------
// Transport

let relayState = 'unknown'; // unknown | ok | unavailable

/** kind: 'search' | 'lyric'. Returns parsed JSON. */
async function call(kind, params) {
  const native = typeof window !== 'undefined' ? window.lyricPlayerNative : null;
  if (native?.netease) return native.netease(kind, params);
  if (relayState === 'unavailable') throw new Error('needs the desktop app or the deployed site');
  const qs = new URLSearchParams({ kind, ...params });
  let r;
  try {
    r = await fetch(`api/netease?${qs}`);
  } catch (e) {
    throw new Error(`relay unreachable (${e.message})`);
  }
  const type = r.headers.get('content-type') || '';
  if (r.status === 404 || r.status === 501 || !type.includes('json')) {
    // Plain static hosting (e.g. local preview): no relay.
    relayState = 'unavailable';
    throw new Error('needs the desktop app or the deployed site');
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  relayState = 'ok';
  return r.json();
}

// ---------------------------------------------------------------------------
// Search

export async function searchNetease(query, limit = 10) {
  const data = await call('search', { s: query, limit: String(limit) });
  const songs = data?.result?.songs || [];
  return songs.map((s) => ({
    source: 'netease',
    id: s.id,
    title: s.name,
    artists: (s.artists || s.ar || []).map((a) => a.name).filter(Boolean),
    album: s.album?.name || s.al?.name || '',
    duration: (s.duration || s.dt || 0) / 1000,
    wordSync: null, // unknown until the lyrics are fetched (see probe)
  }));
}

/** Fetches the lyric payload for a NetEase song id. */
export async function fetchNeteaseLyrics(id) {
  return call('lyric', { id: String(id) });
}

/** Marks the first few results as word- or line-synced (drops ones with no synced lyrics). */
export async function probeNetease(results, count = 5) {
  await Promise.all(results.slice(0, count).map(async (r) => {
    try {
      const d = await fetchNeteaseLyrics(r.id);
      r.payload = d;
      r.wordSync = !!yrcLines(d?.yrc?.lyric).length;
      r.synced = r.wordSync || /\[\d+:\d+/.test(d?.lrc?.lyric || '');
    } catch { /* leave unknown */ }
  }));
  return results.filter((r) => r.synced !== false);
}

// ---------------------------------------------------------------------------
// Conversion

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (ms) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

// Credit lines ("作词: …", "Composer: …") that NetEase puts at the top.
const CREDIT = /^\s*(作词|作詞|作曲|编曲|編曲|制作人|製作人|混音|母带|和声|吉他|贝斯|鼓|弦乐|录音|監製|监制|出品|发行|OP|SP|Lyricist|Lyrics|Composer|Composed|Arranger|Arranged|Producer|Produced|Written)\s*[:：]/i;

/** YRC text → [{ begin, end, words: [{ text, begin, end }] }] (ms). */
export function yrcLines(yrc) {
  const out = [];
  for (const raw of String(yrc || '').split(/\r?\n/)) {
    const head = /^\[(\d+),(\d+)\]/.exec(raw);
    if (!head) continue; // JSON credit lines start with "{"
    const begin = Number(head[1]), end = begin + Number(head[2]);
    const words = [];
    for (const m of raw.slice(head[0].length).matchAll(/\((\d+),(\d+),\d+\)([^(]*)/g)) {
      if (!m[3]) continue;
      words.push({ text: m[3], begin: Number(m[1]), end: Number(m[1]) + Number(m[2]) });
    }
    const text = words.map((w) => w.text).join('').trim();
    if (!text || CREDIT.test(text)) continue;
    out.push({ begin, end, words });
  }
  return out;
}

/** LRC → [{ t (ms), text }] */
function lrcEntries(lrc) {
  const out = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) out.push({ t: (Number(s[1]) * 60 + Number(s[2])) * 1000, text });
  }
  return out.sort((a, b) => a.t - b.t);
}

function translationFor(entries, t) {
  let best = null, bestD = 800; // within 0.8 s of the line start
  for (const e of entries) {
    const d = Math.abs(e.t - t);
    if (d < bestD && e.text && !CREDIT.test(e.text)) { best = e.text; bestD = d; }
  }
  return best;
}

/**
 * NetEase lyric payload → TTML. Uses word-synced YRC when present, else LRC.
 * Translations (tlyric / ytlrc) become x-translation spans.
 */
export function neteaseToTtml(payload, { title = '', artists = [], duration = 0 } = {}) {
  const lines = yrcLines(payload?.yrc?.lyric);
  if (!lines.length) {
    const lrc = (payload?.lrc?.lyric || '')
      .split(/\r?\n/)
      .filter((l) => !CREDIT.test(l.replace(/\[[^\]]*\]/g, '')))
      .join('\n');
    if (!/\[\d+:\d+/.test(lrc)) throw new Error('No synced lyrics for this song on NetEase');
    return lrcToTtml(lrc, { title, artists, duration });
  }
  const trans = lrcEntries(payload?.ytlrc?.lyric || payload?.tlyric?.lyric);
  const roma = lrcEntries(payload?.yromalrc?.lyric || payload?.romalrc?.lyric);
  const body = lines.map((l) => {
    const spans = l.words.map((w) => {
      const lead = /^\s/.test(w.text) ? ' ' : '';
      const trail = /\s$/.test(w.text) ? ' ' : '';
      return `${lead}<span begin="${clock(w.begin)}" end="${clock(Math.max(w.end, w.begin + 30))}">${esc(w.text.trim())}</span>${trail}`;
    }).join('').trim();
    const tr = trans.length ? translationFor(trans, l.begin) : null;
    const trSpan = tr ? `<span ttm:role="x-translation" xml:lang="zh-CN">${esc(tr)}</span>` : '';
    const ro = roma.length ? translationFor(roma, l.begin) : null;
    const roSpan = ro ? `<span ttm:role="x-roman">${esc(ro)}</span>` : '';
    return `<p begin="${clock(l.begin)}" end="${clock(l.end)}">${spans}${trSpan}${roSpan}</p>`;
  });
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">`
    + `<head><metadata><ttm:title>${esc(title)}</ttm:title>${artists.map((a) => `<ttm:name type="artist">${esc(a)}</ttm:name>`).join('')}</metadata></head>`
    + `<body><div>${body.join('')}</div></body></tt>`;
}

// ---------------------------------------------------------------------------
// Relay request validation (shared by the Electron main process and api/netease.js)

/** Builds the upstream NetEase URL for an allowed request, or throws. */
export function neteaseUpstreamUrl(kind, params) {
  if (kind === 'search') {
    const s = String(params.s || '').slice(0, 200).trim();
    if (!s) throw new Error('missing query');
    const limit = Math.min(30, Math.max(1, Number(params.limit) || 10));
    return `https://music.163.com/api/search/get?s=${encodeURIComponent(s)}&type=1&limit=${limit}`;
  }
  if (kind === 'lyric') {
    const id = String(params.id || '');
    if (!/^\d{1,15}$/.test(id)) throw new Error('bad id');
    return `https://music.163.com/api/song/lyric/v1?id=${id}&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0`;
  }
  throw new Error('unknown request');
}
