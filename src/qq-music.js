// QQ Music lyrics: word-synced "QRC" when available, else LRC, plus the
// translation, converted to TTML.
//
// QQ Music doesn't allow cross-site requests, so calls go through a relay that
// only forwards its search and lyric requests (like NetEase):
// - desktop app: the Electron main process (window.lyricPlayerNative)
// - website: the Vercel function in api/qq-music.js
// QRC lyrics come encrypted with QQ Music's own (non-standard) triple DES and
// zlib-compressed. The DES below is a port of wangqr/QQMusicDES (MIT,
// https://github.com/wangqr/QQMusicDES), which reproduces QQ Music's quirks.
// This uses QQ Music's private API; it may change or stop working at any time.

import { lrcToTtml } from './lyrics-search.js';

// ---------------------------------------------------------------------------
// Transport

let relayState = 'unknown';

async function call(kind, params) {
  const native = typeof window !== 'undefined' ? window.lyricPlayerNative : null;
  if (native?.qqMusic) return native.qqMusic(kind, params);
  if (relayState === 'unavailable') throw new Error('needs the desktop app or the deployed site');
  const qs = new URLSearchParams({ kind, ...params });
  let r;
  try {
    r = await fetch(`api/qq-music?${qs}`);
  } catch (e) {
    throw new Error(`relay unreachable (${e.message})`);
  }
  const type = r.headers.get('content-type') || '';
  if (r.status === 404 || r.status === 501 || !type.includes('json')) {
    relayState = 'unavailable';
    throw new Error('needs the desktop app or the deployed site');
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  relayState = 'ok';
  return r.json();
}

// ---------------------------------------------------------------------------
// Relay side (Electron main process and api/qq-music.js)

const QQ_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';

/** { url, body } of the upstream POST for an allowed request, or throws. */
export function qqUpstreamRequest(kind, params = {}) {
  const comm = { ct: '19', cv: '1859', uin: '0' };
  if (kind === 'search') {
    const query = String(params.s || '').slice(0, 200).trim();
    if (!query) throw new Error('missing query');
    const num = Math.min(30, Math.max(1, Number(params.limit) || 10));
    return {
      url: QQ_URL,
      body: JSON.stringify({ comm, req: { method: 'DoSearchForQQMusicDesktop', module: 'music.search.SearchCgiService', param: { grp: 1, num_per_page: num, page_num: 1, query, search_type: 0 } } }),
    };
  }
  if (kind === 'lyric') {
    const id = String(params.id || '');
    if (!/^\d{1,15}$/.test(id)) throw new Error('bad id');
    return {
      url: QQ_URL,
      body: JSON.stringify({ comm, req: { method: 'GetPlayLyricInfo', module: 'music.musichallSong.PlayLyricInfo', param: { songID: Number(id), qrc: 1, trans: 1, roma: 1, crypt: 1 } } }),
    };
  }
  throw new Error('unknown request');
}

export const QQ_HEADERS = {
  Referer: 'https://y.qq.com/',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
};

// ---------------------------------------------------------------------------
// Search

export async function searchQQ(query, limit = 10) {
  const data = await call('search', { s: query, limit: String(limit) });
  const songs = data?.req?.data?.body?.song?.list || [];
  return songs.map((s) => ({
    source: 'qq',
    id: s.id,
    title: s.name || s.title || '',
    artists: (s.singer || []).map((a) => a.name).filter(Boolean),
    album: s.album?.name || '',
    duration: s.interval || 0,
    wordSync: null,
  }));
}

export async function fetchQQLyrics(id) {
  const data = await call('lyric', { id: String(id) });
  const d = data?.req?.data;
  if (!d) throw new Error('no lyrics');
  return {
    lyric: await decodeField(d.lyric, d.crypt),
    trans: await decodeField(d.trans, d.crypt),
    roma: await decodeField(d.roma, d.crypt),
    qrc: !!d.qrc,
  };
}

/** Same as NetEase: fetch the top few, mark word/line sync, drop unsynced. */
export async function probeQQ(results, count = 5) {
  await Promise.all(results.slice(0, count).map(async (r) => {
    try {
      const p = await fetchQQLyrics(r.id);
      r.payload = p;
      r.wordSync = qrcLines(p.lyric).length > 0;
      r.synced = r.wordSync || /\[\d+:\d+/.test(p.lyric);
    } catch { /* leave unknown */ }
  }));
  return results.filter((r) => r.synced !== false);
}

// ---------------------------------------------------------------------------
// Decryption (QQ Music's triple DES + zlib)

const QRC_KEY = new TextEncoder().encode('!@#)(*$%123ZXC!@!@#)(NHL');

const SBOX = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];
const IP0 = [57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7];
const IP1 = [56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6];
const PBOX = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24];
const KEY_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const KEY_PERM_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
const KEY_PERM_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
const KEY_COMPRESSION = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1,
  40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];

// Bit helpers, as in the C original (including its byte order).
const bitnum = (a, off, b, c) => ((a[off + ((b >> 5) << 2) + 3 - ((b & 31) >> 3)] >> (7 - (b & 7))) & 1) << c;
const bitR = (a, b, c) => ((a >>> (31 - b)) & 1) << c;
const bitL = (a, b, c) => ((a << b) & 0x80000000) >>> c;
const sboxbit = (a) => (a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4);

function keySetup(key, off, decrypt) {
  const schedule = Array.from({ length: 16 }, () => new Uint8Array(6));
  let C = 0, D = 0;
  for (let i = 0, j = 31; i < 28; i++, j--) C |= bitnum(key, off, KEY_PERM_C[i], j);
  for (let i = 0, j = 31; i < 28; i++, j--) D |= bitnum(key, off, KEY_PERM_D[i], j);
  C >>>= 0; D >>>= 0;
  for (let i = 0; i < 16; i++) {
    const s = KEY_SHIFT[i];
    C = (((C << s) | (C >>> (28 - s))) & 0xfffffff0) >>> 0;
    D = (((D << s) | (D >>> (28 - s))) & 0xfffffff0) >>> 0;
    const k = schedule[decrypt ? 15 - i : i];
    for (let j = 0; j < 24; j++) k[j >> 3] |= bitR(C, KEY_COMPRESSION[j], 7 - (j & 7));
    for (let j = 24; j < 48; j++) k[j >> 3] |= bitR(D, KEY_COMPRESSION[j] - 27, 7 - (j & 7));
  }
  return schedule;
}

function f(state, key) {
  const t1 = (bitL(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitL(state, 4, 5) | bitL(state, 3, 6)
    | ((state & 0x0f000000) >>> 3) | bitL(state, 8, 11) | bitL(state, 7, 12) | ((state & 0x00f00000) >>> 5)
    | bitL(state, 12, 17) | bitL(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitL(state, 16, 23)) >>> 0;
  const t2 = (bitL(state, 15, 0) | ((state & 0x0000f000) << 15) | bitL(state, 20, 5) | bitL(state, 19, 6)
    | ((state & 0x00000f00) << 13) | bitL(state, 24, 11) | bitL(state, 23, 12) | ((state & 0x000000f0) << 11)
    | bitL(state, 28, 17) | bitL(state, 27, 18) | ((state & 0x0000000f) << 9) | bitL(state, 0, 23)) >>> 0;
  const l = [
    ((t1 >>> 24) & 0xff) ^ key[0], ((t1 >>> 16) & 0xff) ^ key[1], ((t1 >>> 8) & 0xff) ^ key[2],
    ((t2 >>> 24) & 0xff) ^ key[3], ((t2 >>> 16) & 0xff) ^ key[4], ((t2 >>> 8) & 0xff) ^ key[5],
  ];
  const s = ((SBOX[0][sboxbit(l[0] >> 2)] << 28)
    | (SBOX[1][sboxbit(((l[0] & 0x03) << 4) | (l[1] >> 4))] << 24)
    | (SBOX[2][sboxbit(((l[1] & 0x0f) << 2) | (l[2] >> 6))] << 20)
    | (SBOX[3][sboxbit(l[2] & 0x3f)] << 16)
    | (SBOX[4][sboxbit(l[3] >> 2)] << 12)
    | (SBOX[5][sboxbit(((l[3] & 0x03) << 4) | (l[4] >> 4))] << 8)
    | (SBOX[6][sboxbit(((l[4] & 0x0f) << 2) | (l[5] >> 6))] << 4)
    | SBOX[7][sboxbit(l[5] & 0x3f)]) >>> 0;
  let out = 0;
  for (let i = 0; i < 32; i++) out |= bitL(s, PBOX[i], i);
  return out >>> 0;
}

function desBlock(buf, off, schedule) {
  let s0 = 0, s1 = 0;
  for (let i = 0; i < 32; i++) {
    s0 |= bitnum(buf, off, IP0[i], 31 - i);
    s1 |= bitnum(buf, off, IP1[i], 31 - i);
  }
  s0 >>>= 0; s1 >>>= 0;
  for (let r = 0; r < 15; r++) {
    const t = s1;
    s1 = (f(s1, schedule[r]) ^ s0) >>> 0;
    s0 = t;
  }
  s0 = (f(s1, schedule[15]) ^ s0) >>> 0;
  const order = [3, 2, 1, 0, 7, 6, 5, 4];
  for (let i = 0; i < 8; i++) {
    const k = 7 - i;
    buf[off + order[i]] = bitR(s1, k, 7) | bitR(s0, k, 6) | bitR(s1, k + 8, 5) | bitR(s0, k + 8, 4)
      | bitR(s1, k + 16, 3) | bitR(s0, k + 16, 2) | bitR(s1, k + 24, 1) | bitR(s0, k + 24, 0);
  }
}

let schedules = null;

/** Decrypts QQ Music's triple DES (in place, 8-byte blocks). */
export function qqTripleDesDecrypt(bytes) {
  // Decrypt: last key part first, the middle one in encrypt mode (as QQ does).
  schedules ??= [keySetup(QRC_KEY, 16, true), keySetup(QRC_KEY, 8, false), keySetup(QRC_KEY, 0, true)];
  for (let off = 0; off + 8 <= bytes.length; off += 8) {
    for (const s of schedules) desBlock(bytes, off, s);
  }
  return bytes;
}

let encSchedules = null;

/** The reverse of qqTripleDesDecrypt (used by the tests). */
export function qqTripleDesEncrypt(bytes) {
  encSchedules ??= [keySetup(QRC_KEY, 0, false), keySetup(QRC_KEY, 8, true), keySetup(QRC_KEY, 16, false)];
  for (let off = 0; off + 8 <= bytes.length; off += 8) {
    for (const s of encSchedules) desBlock(bytes, off, s);
  }
  return bytes;
}

async function inflateExact(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// The decrypted data is padded to 8 bytes, which the decompressor rejects as
// trailing junk; drop the padding (at most 7 bytes) until it reads cleanly.
async function inflate(bytes) {
  let lastError;
  for (let cut = 0; cut < 8 && cut < bytes.length; cut++) {
    try { return await inflateExact(bytes.subarray(0, bytes.length - cut)); } catch (e) { lastError = e; }
  }
  throw lastError;
}

const hexBytes = (hex) => {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};

/** Hex QRC → text (the QRC XML, or LRC). */
export async function decryptQrc(hex) {
  return inflate(qqTripleDesDecrypt(hexBytes(hex)));
}

async function decodeField(value, crypt) {
  if (!value) return '';
  if (crypt && /^[0-9A-Fa-f]+$/.test(value) && value.length % 16 === 0) {
    try { return await decryptQrc(value); } catch { return ''; }
  }
  // Unencrypted answers are base64.
  try { return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))); } catch { return String(value); }
}

// ---------------------------------------------------------------------------
// Conversion

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (ms) => {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};
const CREDIT = /^\s*(作词|作詞|作曲|编曲|編曲|制作人|製作人|混音|母带|和声|吉他|贝斯|鼓|弦乐|录音|監製|监制|出品|发行|OP|SP|Lyricist|Lyrics|Composer|Composed|Arranger|Arranged|Producer|Produced|Written|Mixed|Mastered|Recorded)(\s+by)?\s*[:：]/i;
const decodeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e] ?? String.fromCharCode(Number(e.slice(1))));

/** The QRC body: LyricContent="…" inside the XML (or the text itself). */
function qrcBody(text) {
  const m = /LyricContent="([\s\S]*?)"\s*\/>/.exec(text || '');
  return m ? decodeXml(m[1]) : String(text || '');
}

/** QRC → [{ begin, end, words: [{ text, begin, end }] }] (ms). Lines look like
 *  [1000,2500]Word(1000,300) word(1300,400)… */
export function qrcLines(text) {
  const out = [];
  for (const raw of qrcBody(text).split(/\r?\n/)) {
    const head = /^\[(\d+),(\d+)\]/.exec(raw.trim());
    if (!head) continue;
    const begin = Number(head[1]), end = begin + Number(head[2]);
    const words = [];
    for (const m of raw.trim().slice(head[0].length).matchAll(/([^(]*)\((\d+),(\d+)\)/g)) {
      if (!m[1]) continue;
      words.push({ text: m[1], begin: Number(m[2]), end: Number(m[2]) + Number(m[3]) });
    }
    const line = words.map((w) => w.text).join('').trim();
    if (!line || CREDIT.test(line) || /^.{0,40} - .{0,40}$/.test(line) && begin < 1000 && out.length === 0) continue;
    out.push({ begin, end, words });
  }
  return out;
}

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
  let best = null, bestD = 800;
  for (const e of entries) {
    const d = Math.abs(e.t - t);
    if (d < bestD && e.text && e.text !== '//' && !CREDIT.test(e.text) && !/著作权/.test(e.text)) { best = e.text; bestD = d; }
  }
  return best;
}

/** { lyric, trans } from fetchQQLyrics → TTML (word timing when QRC, else line). */
export function qqToTtml(payload, { title = '', artists = [], duration = 0 } = {}) {
  const lines = qrcLines(payload?.lyric);
  if (!lines.length) {
    const lrc = String(payload?.lyric || '').split(/\r?\n/).filter((l) => !CREDIT.test(l.replace(/\[[^\]]*\]/g, ''))).join('\n');
    if (!/\[\d+:\d+/.test(lrc)) throw new Error('No synced lyrics for this song on QQ Music');
    return lrcToTtml(lrc, { title, artists, duration });
  }
  const trans = lrcEntries(payload?.trans);
  // Romanization (Japanese / Korean / Cantonese) comes as a second QRC.
  const roma = qrcLines(payload?.roma).map((r) => ({ t: r.begin, text: r.words.map((w) => w.text).join('').replace(/\s+/g, ' ').trim() }));
  const body = lines.map((l) => {
    const spans = l.words.map((w) => {
      const lead = /^\s/.test(w.text) ? ' ' : '';
      const trail = /\s$/.test(w.text) ? ' ' : '';
      const t = w.text.trim();
      if (!t) return ' ';
      return `${lead}<span begin="${clock(w.begin)}" end="${clock(Math.max(w.end, w.begin + 30))}">${esc(t)}</span>${trail}`;
    }).join('').replace(/\s+/g, ' ').trim();
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
