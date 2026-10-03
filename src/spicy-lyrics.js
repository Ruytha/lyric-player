// Spicy Lyrics (developers.spicylyrics.org): syllable-synced lyrics, from its
// community syncs, Apple Music or Spotify. Its API needs a secret key that
// must stay on a server, so the app asks the website (api/spicy-lyrics.js),
// which finds the song's Spotify ID and turns the answer into TTML.
//
// Spicy Lyrics' terms, which this follows:
//  - credit on screen wherever the lyrics show: "Lyrics from Spicy Lyrics",
//    plus the uploader and maker (linked) for community syncs;
//  - lyrics kept for at most 30 days, then fetched again;
//  - no exporting them as files.
// The credit and the fetch time travel inside the TTML (<lp:credit>), so
// saved lyrics keep them.

export const CREDIT_NS = 'https://files.ruytha.dev/ns/lyric-player';
export const SPICY_MAX_AGE = 30 * 24 * 3600 * 1000;
const SITE = 'https://files.ruytha.dev';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clock = (sec) => {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

// ---------------------------------------------------------------- converting

/** Spicy Lyrics syllables → TTML spans (syllables of one word touch; words get a space). */
function spans(syllables = []) {
  let out = '';
  syllables.forEach((s, i) => {
    const text = String(s.Text ?? '');
    if (!text.trim()) return;
    out += `<span begin="${clock(s.StartTime)}" end="${clock(Math.max(s.EndTime, s.StartTime + 0.03))}">${esc(text.trim())}</span>`;
    if (i < syllables.length - 1 && !s.IsPartOfWord) out += ' ';
  });
  return out.trim();
}

const roman = (syllables = []) => {
  if (!syllables.some((s) => s.TransliteratedText)) return '';
  let t = '';
  syllables.forEach((s, i) => { t += s.TransliteratedText ?? s.Text ?? ''; if (i < syllables.length - 1 && !s.IsPartOfWord) t += ' '; });
  return t.replace(/\s+/g, ' ').trim();
};

/** Who to credit, from a Spicy Lyrics answer. */
export function creditFrom(body) {
  const src = String(body?.source || '').toLowerCase();
  const ua = body?.UploadAttribution || {};
  const person = (p) => (p && (p.username || p.Username) ? { name: String(p.username || p.Username), url: String(p.url || p.Url || p.profileUrl || '') } : null);
  const community = src === 'spicy_lyrics' || src === 'spl' || !!(ua.Uploader || ua.Maker);
  return {
    provider: 'Spicy Lyrics',
    source: community ? 'community' : src === 'aml' || src === 'apple_music' ? 'apple' : src === 'spt' || src === 'spotify' ? 'spotify' : src || 'unknown',
    uploader: community ? person(ua.Uploader) : null,
    maker: community ? person(ua.Maker) : null,
  };
}

/** A Spicy Lyrics answer ({ Body: { Type, Content | Lines, … } } or the Body itself) → TTML. */
export function spicyToTtml(answer, { title = '', artists = [], fetched = Date.now() } = {}) {
  const body = answer?.Body && (answer.Body.Type || answer.Body.Content || answer.Body.Lines) ? answer.Body : answer;
  const type = String(body?.Type || '');
  const credit = creditFrom(body);
  const p = [];
  let timing = 'Word';
  if (type === 'Syllable') {
    for (const line of body.Content || []) {
      const lead = line.Lead || line;
      const main = spans(lead.Syllables);
      if (!main) continue;
      const bg = (line.Background || []).map((b) => spans(b.Syllables)).filter(Boolean);
      const ro = roman(lead.Syllables);
      const agent = line.OppositeAligned ? 'v2' : 'v1';
      const end = Math.max(lead.EndTime ?? 0, ...(line.Background || []).map((b) => b.EndTime ?? 0));
      p.push(`<p begin="${clock(lead.StartTime)}" end="${clock(end)}" ttm:agent="${agent}">${main}${bg.map((b) => ` <span ttm:role="x-bg">${b}</span>`).join('')}${ro ? `<span ttm:role="x-roman">${esc(ro)}</span>` : ''}</p>`);
    }
  } else if (type === 'Line') {
    timing = 'Line';
    for (const line of body.Content || []) {
      const text = String(line.Text ?? '').trim();
      if (!text) continue;
      const ro = line.TransliteratedText ? `<span ttm:role="x-roman">${esc(line.TransliteratedText)}</span>` : '';
      p.push(`<p begin="${clock(line.StartTime)}" end="${clock(Math.max(line.EndTime, line.StartTime + 0.5))}" ttm:agent="${line.OppositeAligned ? 'v2' : 'v1'}">${esc(text)}${ro}</p>`);
    }
  } else if (type === 'Static') {
    timing = 'None';
    for (const line of body.Lines || []) {
      const text = String(line.Text ?? '').trim();
      if (text) p.push(`<p>${esc(text)}</p>`);
    }
  } else {
    throw new Error(`Spicy Lyrics sent lyrics of an unknown kind (${type || 'none'})`);
  }
  if (!p.length) throw new Error('Spicy Lyrics has no lines for this song');
  const person = (k, v) => (v ? ` ${k}="${esc(v.name)}" ${k}Url="${esc(v.url)}"` : '');
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:lp="${CREDIT_NS}" itunes:timing="${timing}">`
    + `<head><metadata><ttm:title>${esc(title)}</ttm:title>${artists.map((a) => `<ttm:name type="artist">${esc(a)}</ttm:name>`).join('')}`
    + '<ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/>'
    + `<lp:credit provider="${esc(credit.provider)}" source="${esc(credit.source)}"${person('uploader', credit.uploader)}${person('maker', credit.maker)} fetched="${Math.round(fetched)}"/>`
    + `</metadata></head><body><div>${p.join('')}</div></body></tt>`;
}

// ---------------------------------------------------------------- credit

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : '';
};

/** The credit inside a TTML (null if it has none). */
export function readCredit(ttml) {
  const m = /<lp:credit\b[^>]*\/?>/.exec(String(ttml || ''));
  if (!m) return null;
  const t = m[0];
  const person = (k) => (attr(t, k) ? { name: attr(t, k), url: attr(t, `${k}Url`) } : null);
  return { provider: attr(t, 'provider'), source: attr(t, 'source'), uploader: person('uploader'), maker: person('maker'), fetched: Number(attr(t, 'fetched')) || 0 };
}

/** Lyrics from Spicy Lyrics kept longer than its terms allow (30 days). */
export const isExpired = (credit, now = Date.now()) => !!credit && credit.provider === 'Spicy Lyrics' && (!credit.fetched || now - credit.fetched > SPICY_MAX_AGE);

/** Whether these lyrics may be exported as a file. */
export const mayExport = (credit) => !credit || credit.provider !== 'Spicy Lyrics';

// ---------------------------------------------------------------- searching

const apiBase = () => (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname) ? '' : SITE);

/**
 * Looks a song up on Spicy Lyrics (through the website). Returns [] or one
 * result carrying its TTML, in the same shape as the other sources.
 */
export async function searchSpicy(query, { title = '', artist = '', duration = 0 } = {}) {
  const q = new URLSearchParams();
  if (title) { q.set('title', title); if (artist) q.set('artist', artist); } else q.set('q', String(query || '').slice(0, 200));
  if (duration > 0) q.set('duration', String(Math.round(duration)));
  const r = await fetch(`${apiBase()}/api/spicy-lyrics?${q}`);
  if (r.status === 501) throw new Error('not set up on the website yet');
  const type = r.headers.get('content-type') || '';
  if (!type.includes('json')) throw new Error('needs the deployed site or the app');
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  if (!d.found || !d.ttml) return [];
  return [{
    source: 'spicy', id: d.spotifyId, title: d.title, artists: d.artists || [], album: d.album || '', duration: d.duration || 0,
    wordSync: d.type === 'Syllable', synced: d.type !== 'Static', ttml: d.ttml, credit: readCredit(d.ttml),
  }];
}
