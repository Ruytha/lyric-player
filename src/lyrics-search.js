// Finds lyrics online, free and without an Apple developer account:
//
// 1. AMLL TTML DB (github.com/amll-dev/amll-ttml-db, CC0): community-made,
//    word-synced TTML in Apple Music's format, with background vocals and
//    duets. Searched locally from its index (~1.6 MB, fetched once).
// 2. NetEase Cloud Music (see netease.js): many songs word-synced, via a relay.
// 3. BiniLyrics (see binilyrics.js): TTML in Apple Music's format.
// 4. LRCLIB (lrclib.net): huge open database of line-synced LRC lyrics,
//    converted to line-timed TTML here (word timing kept when the LRC has it).

import { searchNetease, probeNetease, fetchNeteaseLyrics, neteaseToTtml } from './netease.js';
import { searchQQ, probeQQ, fetchQQLyrics, qqToTtml } from './qq-music.js';
import { searchAppleMusic, fetchAppleTtml } from './apple-music.js';
import { searchBini, fetchBiniTtml } from './binilyrics.js';
import { searchSpicy } from './spicy-lyrics.js';

const DB_RAW = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main';
const LRCLIB = 'https://lrclib.net/api';

// ---------------------------------------------------------------------------
// Text matching

export const fold = (s) => String(s || '')
  .normalize('NFKD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[’'`"“”]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const tokens = (s) => fold(s).split(' ').filter(Boolean);

/** Higher is better; 0 means "doesn't match". */
export function scoreMatch(query, { title, artists = [], album = '' }) {
  const q = tokens(query);
  if (!q.length) return 0;
  const t = fold(title), a = fold(artists.join(' ')), al = fold(album);
  const hay = ` ${t} ${a} ${al} `;
  if (!q.every((w) => hay.includes(` ${w}`))) return 0;
  const fq = fold(query);
  let score = 1;
  if (t === fq) score += 10;
  if (fq.startsWith(t) || fq.endsWith(t)) score += 4;      // "title artist" / "artist title"
  if (t.startsWith(q[0]) || fq.includes(t)) score += 2;
  for (const w of q) {
    if (` ${t} `.includes(` ${w} `)) score += 1.5;
    if (` ${a} `.includes(` ${w} `)) score += 1;
  }
  return score;
}

// ---------------------------------------------------------------------------
// AMLL TTML DB

let indexPromise = null;

function meta(row, key) {
  const m = row.metadata.find(([k]) => k === key);
  return m ? m[1] : [];
}

/** Loads and de-duplicates the DB index (newest revision of each song wins). */
export function loadAmllIndex() {
  indexPromise ??= fetch(`${DB_RAW}/metadata/raw-lyrics-index.jsonl`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then((text) => {
      const byKey = new Map();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const title = meta(row, 'musicName')[0];
        if (!title || !row.rawLyricFile) continue;
        const artists = meta(row, 'artists');
        const entry = {
          source: 'amll',
          title,
          altTitles: meta(row, 'musicName').slice(1),
          artists,
          album: meta(row, 'album')[0] || '',
          file: row.rawLyricFile,
          appleMusicId: meta(row, 'appleMusicId')[0] || null,
          author: meta(row, 'ttmlAuthorGithubLogin')[0] || null,
          stamp: Number(row.rawLyricFile.split('-')[0]) || 0,
        };
        const key = entry.appleMusicId
          || meta(row, 'ncmMusicId')[0]
          || meta(row, 'spotifyId')[0]
          || `${fold(title)}|${fold(artists.join(' '))}`;
        const prev = byKey.get(key);
        if (!prev || entry.stamp > prev.stamp) byKey.set(key, entry);
      }
      return [...byKey.values()];
    })
    .catch((e) => { indexPromise = null; throw e; });
  return indexPromise;
}

export async function searchAmll(query, limit = 30) {
  const index = await loadAmllIndex();
  const hits = [];
  for (const e of index) {
    let s = scoreMatch(query, e);
    for (const alt of e.altTitles) s = Math.max(s, scoreMatch(query, { ...e, title: alt }));
    if (s > 0) hits.push([s, e]);
  }
  hits.sort((x, y) => y[0] - x[0] || y[1].stamp - x[1].stamp);
  return hits.slice(0, limit).map(([, e]) => e);
}

async function fetchAmllTtml(entry) {
  const r = await fetch(`${DB_RAW}/raw-lyrics/${encodeURIComponent(entry.file)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// ---------------------------------------------------------------------------
// LRCLIB

export async function searchLrclib(query, limit = 20) {
  const r = await fetch(`${LRCLIB}/search?q=${encodeURIComponent(query)}`, {
    headers: { 'Lrclib-Client': 'Lyric Player by Ruytha' },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const list = await r.json();
  return list
    .filter((x) => x.syncedLyrics && !x.instrumental)
    .slice(0, limit)
    .map((x) => ({
      source: 'lrclib',
      title: x.trackName || x.name,
      artists: [x.artistName].filter(Boolean),
      album: x.albumName || '',
      duration: x.duration,
      lrc: x.syncedLyrics,
      wordSync: /<\d+:\d+(?:\.\d+)?>/.test(x.syncedLyrics),
    }));
}

const xmlEscape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function clock(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
}

const parseStamp = (m, s) => Number(m) * 60 + Number(s);

/**
 * LRC (incl. enhanced <mm:ss.xx> word tags) → TTML. Lines end where the next
 * line starts (capped at 10 s); the last line gets 5 s.
 */
export function lrcToTtml(lrc, { title = '', artists = [], duration = 0 } = {}) {
  const lines = [];
  for (const raw of String(lrc).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '');
    for (const st of stamps) lines.push({ begin: parseStamp(st[1], st[2]), text });
  }
  lines.sort((a, b) => a.begin - b.begin);
  const body = [];
  lines.forEach((l, i) => {
    const plain = l.text.replace(/<\d+:\d+(?:\.\d+)?>/g, '').replace(/\s+/g, ' ').trim();
    if (!plain) return; // instrumental gap marker
    const next = lines[i + 1]?.begin;
    const end = next != null ? Math.min(next, l.begin + 10) : Math.max(l.begin + 5, Math.min(duration || 0, l.begin + 10));
    // Enhanced LRC: <time> word <time> word … → word-timed spans.
    const parts = [...l.text.matchAll(/<(\d+):(\d+(?:\.\d+)?)>([^<]*)/g)];
    if (parts.length) {
      const spans = [];
      parts.forEach((p, k) => {
        const w = p[3];
        if (!w.trim()) return;
        const b = parseStamp(p[1], p[2]);
        const e = parts[k + 1] ? parseStamp(parts[k + 1][1], parts[k + 1][2]) : end;
        spans.push(`<span begin="${clock(b)}" end="${clock(Math.max(e, b + 0.05))}">${xmlEscape(w.trim())}</span>${/\s$/.test(w) ? ' ' : ''}`);
      });
      body.push(`<p begin="${clock(l.begin)}" end="${clock(end)}">${spans.join('').trim()}</p>`);
    } else {
      body.push(`<p begin="${clock(l.begin)}" end="${clock(end)}">${xmlEscape(plain)}</p>`);
    }
  });
  const timing = /<span/.test(body.join('')) ? 'Word' : 'Line';
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="${timing}">`
    + `<head><metadata><ttm:title>${xmlEscape(title)}</ttm:title>${artists.map((a) => `<ttm:name type="artist">${xmlEscape(a)}</ttm:name>`).join('')}</metadata></head>`
    + `<body><div>${body.join('')}</div></body></tt>`;
}

// ---------------------------------------------------------------------------

/**
 * Search all sources. Order: Apple Music (your subscription, when signed in
 * and enabled), AMLL DB, BiniLyrics, NetEase and QQ Music word-synced,
 * BiniLyrics line-timed, LRCLIB, then the other NetEase / QQ Music results.
 */
export async function searchLyrics(query, { apple = false, song = null } = {}) {
  const [am, spicy, amll, bini, netease, qq, lrclib] = await Promise.allSettled([
    apple ? searchAppleMusic(query) : Promise.resolve([]),
    searchSpicy(query, song || {}),
    searchAmll(query),
    searchBini(query),
    searchNetease(query).then((r) => probeNetease(r)),
    searchQQ(query).then((r) => probeQQ(r)),
    searchLrclib(query),
  ]);
  const ok = (r) => (r.status === 'fulfilled' ? r.value : []);
  const ne = ok(netease), qm = ok(qq), bl = ok(bini);
  return {
    results: [
      ...ok(am),
      ...ok(spicy).filter((r) => r.wordSync),
      ...ok(amll),
      ...bl.filter((r) => r.wordSync),
      ...ne.filter((r) => r.wordSync),
      ...qm.filter((r) => r.wordSync),
      ...bl.filter((r) => !r.wordSync),
      ...ok(spicy).filter((r) => !r.wordSync),
      ...ok(lrclib),
      ...ne.filter((r) => !r.wordSync),
      ...qm.filter((r) => !r.wordSync),
    ],
    errors: [
      am.status === 'rejected' ? `Apple Music: ${am.reason.message}` : null,
      spicy.status === 'rejected' ? `Spicy Lyrics: ${spicy.reason.message}` : null,
      amll.status === 'rejected' ? `AMLL DB: ${amll.reason.message}` : null,
      bini.status === 'rejected' ? `BiniLyrics: ${bini.reason.message}` : null,
      netease.status === 'rejected' ? `NetEase: ${netease.reason.message}` : null,
      qq.status === 'rejected' ? `QQ Music: ${qq.reason.message}` : null,
      lrclib.status === 'rejected' ? `LRCLIB: ${lrclib.reason.message}` : null,
    ].filter(Boolean),
  };
}

/** Readable name of a result's source. */
export const SOURCE_NAMES = { apple: 'Apple Music', spicy: 'Spicy Lyrics', amll: 'AMLL TTML DB', bini: 'BiniLyrics', netease: 'NetEase', qq: 'QQ Music', lrclib: 'LRCLIB' };

/** Returns TTML text for a search result. */
export async function getTtml(result) {
  if (result.source === 'spicy') return result.ttml;
  if (result.source === 'amll') return fetchAmllTtml(result);
  if (result.source === 'apple') return fetchAppleTtml(result.id);
  if (result.source === 'bini') return fetchBiniTtml(result);
  if (result.source === 'qq') {
    const payload = result.payload || await fetchQQLyrics(result.id);
    return qqToTtml(payload, result);
  }
  if (result.source === 'netease') {
    const payload = result.payload || await fetchNeteaseLyrics(result.id);
    return neteaseToTtml(payload, result);
  }
  return lrcToTtml(result.lrc, result);
}
