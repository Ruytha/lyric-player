// Songwriters for lyrics that don't list them, from MusicBrainz (free, open
// music data): the recording → the song ("work") it performs → its writers,
// composers and lyricists. Answers are remembered per song in localStorage.

const API = 'https://musicbrainz.org/ws/2';
const CACHE = 'lyricplayer:songwriters';
const ROLES = new Set(['writer', 'composer', 'lyricist', 'librettist']);
const MAX_CACHE = 400;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\s*[([].*?(feat|ft|with|remaster|version|edit|live|mix)[^)\]]*[)\]]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const quote = (s) => `"${String(s).replace(/["\\]/g, ' ')}"`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE)) || {}; } catch { return {}; }
}
function writeCache(key, names) {
  try {
    const c = readCache();
    c[key] = { names, at: Date.now() };
    const keys = Object.keys(c);
    if (keys.length > MAX_CACHE) keys.sort((a, b) => c[a].at - c[b].at).slice(0, keys.length - MAX_CACHE).forEach((k) => delete c[k]);
    localStorage.setItem(CACHE, JSON.stringify(c));
  } catch { /* storage full or unavailable */ }
}

// MusicBrainz asks for at most one request a second.
let queue = Promise.resolve();
let lastCall = 0;
function mb(path, fetchFn) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCall + 1100 - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      const r = await fetchFn(`${API}/${path}${path.includes('?') ? '&' : '?'}fmt=json`, { headers: { Accept: 'application/json' } });
      // 503: busy (rate limit); try again a little later.
      if (r.status === 503 && attempt < 3) { await sleep(2000 * (attempt + 1)); continue; }
      if (!r.ok) throw new Error(`MusicBrainz HTTP ${r.status}`);
      return r.json();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/** Writers from a work's artist relations, in order, without repeats. */
export function writersOf(work) {
  const seen = new Set();
  const out = [];
  for (const r of work?.relations || []) {
    const name = r.artist?.name;
    if (!ROLES.has(r.type) || !name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Recordings worth trying: same title and artist, best first. */
export function pickRecordings(recordings, { title, artist, duration }) {
  const t = norm(title), a = norm(artist).split(' ')[0];
  return (recordings || [])
    .filter((r) => (r.score ?? 100) >= 80 && norm(r.title) === t
      && (!a || (r['artist-credit'] || []).some((c) => norm(c.name || c.artist?.name).includes(a))))
    .map((r) => ({ r, off: duration && r.length ? Math.abs(r.length / 1000 - duration) : 0 }))
    .sort((x, y) => x.off - y.off)
    .map((x) => x.r);
}

/**
 * Songwriters for { title, artist, duration } or [] when unknown. Remembered,
 * so each song is looked up once.
 */
export async function lookupSongwriters({ title, artist, duration = 0 }, { fetchFn = fetch } = {}) {
  if (!title || !artist) return [];
  const key = `${norm(title)}|${norm(artist)}`;
  const hit = readCache()[key];
  if (hit) return hit.names;
  const q = `recording:${quote(title)} AND artist:${quote(String(artist).split(/,|&| feat\.? | ft\.? /i)[0].trim())}`;
  const found = await mb(`recording?query=${encodeURIComponent(q)}&limit=10`, fetchFn);
  let names = [];
  const tried = new Set();
  for (const rec of pickRecordings(found.recordings, { title, artist, duration }).slice(0, 3)) {
    const full = await mb(`recording/${rec.id}?inc=work-rels`, fetchFn);
    const work = (full.relations || []).find((r) => r.type === 'performance' && r.work?.id)?.work;
    if (!work || tried.has(work.id)) continue;
    tried.add(work.id);
    names = writersOf(await mb(`work/${work.id}?inc=artist-rels`, fetchFn));
    if (names.length) break;
  }
  writeCache(key, names);
  return names;
}
