// Romanization for lyrics that don't come with one (Settings → Lyrics →
// Romanization). Korean (Hangul) and Japanese kana are romanized here; lines
// with kanji or Chinese characters borrow the romanization NetEase or QQ Music
// have for the same song, matched line by line.

// ---------------------------------------------------------------------------
// Korean: Revised Romanization, with the common sound changes between syllables

const L = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
// Final consonant at the end of a word / before another consonant.
const T = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];
// Before a vowel the final moves to the next syllable: [kept, carried].
const LIAISON = {
  1: ['', 'g'], 2: ['', 'kk'], 3: ['k', 's'], 4: ['', 'n'], 5: ['n', 'j'], 6: ['', 'n'], 7: ['', 'd'], 8: ['', 'r'],
  9: ['l', 'g'], 10: ['l', 'm'], 11: ['l', 'b'], 12: ['l', 's'], 13: ['l', 't'], 14: ['l', 'p'], 15: ['', 'r'],
  16: ['', 'm'], 17: ['', 'b'], 18: ['p', 's'], 19: ['', 's'], 20: ['', 'ss'], 21: ['ng', ''], 22: ['', 'j'],
  23: ['', 'ch'], 24: ['', 'k'], 25: ['', 't'], 26: ['', 'p'], 27: ['', ''],
};

const isHangul = (c) => c >= 0xac00 && c <= 0xd7a3;

export function romanizeHangul(text) {
  const chars = [...String(text)];
  const syl = chars.map((ch) => {
    const c = ch.codePointAt(0);
    if (!isHangul(c)) return null;
    const i = c - 0xac00;
    return { l: Math.floor(i / 588), v: Math.floor((i % 588) / 28), t: i % 28 };
  });
  let out = '';
  for (let k = 0; k < chars.length; k++) {
    const s = syl[k];
    if (!s) { out += chars[k]; continue; }
    const prev = syl[k - 1];
    let initial = L[s.l];
    // The previous syllable's final carried over (handled there) or assimilated.
    if (prev && prev.t) {
      if (s.l === 11 && LIAISON[prev.t]) initial = LIAISON[prev.t][1];
      else if (s.l === 5 && (prev.t === 4 || prev.t === 8)) initial = 'l';      // ㄴㄹ / ㄹㄹ → ll
    }
    let final = '';
    if (s.t) {
      const next = syl[k + 1];
      if (next && next.l === 11 && LIAISON[s.t]) final = LIAISON[s.t][0];
      else if (next && next.l === 5 && s.t === 4) final = 'l';                  // ㄴ before ㄹ
      else if (next && (next.l === 2 || next.l === 6) && [1, 2, 3, 9, 24].includes(s.t)) final = 'ng'; // ㄱ before ㄴ/ㅁ
      else if (next && (next.l === 2 || next.l === 6) && [17, 18, 26].includes(s.t)) final = 'm';     // ㅂ before ㄴ/ㅁ
      else if (next && (next.l === 2 || next.l === 6) && [7, 19, 20, 22, 23, 25].includes(s.t)) final = 'n'; // ㄷ-type before ㄴ/ㅁ
      else final = T[s.t];
    }
    out += initial + V[s.v] + final;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Japanese kana: Hepburn

const KANA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
};
const SMALL_Y = { ゃ: 'a', ゅ: 'u', ょ: 'o' };
const SMALL_V = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
const PUNCT = { '、': ',', '。': '.', '！': '!', '？': '?', '「': '"', '」': '"', '『': '"', '』': '"', '・': ' ', '〜': '~', '～': '~', '　': ' ', '（': '(', '）': ')' };

const toHiragana = (ch) => {
  const c = ch.codePointAt(0);
  return c >= 0x30a1 && c <= 0x30f6 ? String.fromCodePoint(c - 0x60) : ch;
};

export function romanizeKana(text) {
  const chars = [...String(text)].map(toHiragana);
  let out = '';
  let sokuon = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], nx = chars[i + 1];
    if (ch === 'っ') { sokuon = true; continue; }
    if (ch === 'ー') { const m = /[aeiou]$/.exec(out); out += m ? m[0] : ''; continue; }
    let r = KANA[ch];
    if (r === undefined) { out += PUNCT[ch] ?? ch; sokuon = false; continue; }
    // きゃ → kya, しゃ → sha, ちゃ → cha, じゃ → ja; ふぁ → fa, てぃ → ti
    if (nx && SMALL_Y[nx] && /i$/.test(r) && r.length > 1) {
      r = /^(sh|ch|j)i$/.test(r) ? r.slice(0, -1) + SMALL_Y[nx] : r.slice(0, -1) + 'y' + SMALL_Y[nx];
      i++;
    } else if (nx && SMALL_V[nx] && r.length > 1 && !/^[aeiou]$/.test(r)) {
      r = r.replace(/[aeiou]$/, '').replace(/^(ts|f|ch|sh|j)u?$/, '$1').replace(/^([td])$/, '$1') + SMALL_V[nx];
      i++;
    }
    if (sokuon) { out += r.startsWith('ch') ? 't' : r[0]; sokuon = false; }
    // ん before a vowel or y: n'
    if (ch === 'ん' && nx && /^[aeiouy]/.test(KANA[toHiragana(nx)] || '')) r = "n'";
    // は / へ / を as particles can't be told apart without a dictionary; kept as written.
    out += r;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Which lines need what

const HANGUL = /[가-힯]/;
const KANA_RE = /[぀-ゟ゠-ヿ]/;
const HAN = /[㐀-䶿一-鿿]/;

/** 'ko' | 'kana' | 'han' | null for a line of lyrics. */
export function scriptOf(text) {
  const s = String(text || '');
  if (HANGUL.test(s)) return 'ko';
  if (HAN.test(s)) return 'han';
  if (KANA_RE.test(s)) return 'kana';
  return null;
}

/** Takes away the romanization added here (the TTML's own stays). */
export function clearAddedRomanization(model) {
  for (const line of model?.lines || []) if (line.romanizedHere) { line.romanization = null; line.romanizedHere = false; }
  if (model) model.hasRomanization = (model.lines || []).some((l) => l.romanization);
}

/**
 * Fills in line.romanization where the TTML has none and it can be done
 * here. Returns { done, needsLookup }: needsLookup when some lines have
 * kanji / Chinese characters and no romanization.
 */
export function romanizeLocally(model) {
  let done = 0, needsLookup = false;
  for (const line of model?.lines || []) {
    if (line.romanization || !line.text) continue;
    const script = scriptOf(line.text);
    if (script === 'ko') { line.romanization = romanizeHangul(line.text); line.romanizedHere = true; done++; }
    else if (script === 'kana') { line.romanization = romanizeKana(line.text); line.romanizedHere = true; done++; }
    else if (script === 'han') needsLookup = true;
  }
  if (done) model.hasRomanization = true;
  return { done, needsLookup };
}

// ---------------------------------------------------------------------------
// Borrowing from NetEase / QQ Music

/** LRC → [{ t (s), text }] */
export function lrcEntries(lrc) {
  const out = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!text) continue;
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Puts borrowed romanization lines ([{ t, text }]) on the model's lines that
 * need one: by order when both have the same number of lines, otherwise by
 * the nearest start time. Returns how many lines got one (0 = didn't fit).
 */
export function mergeRomanization(model, entries) {
  const lines = (model?.lines || []).filter((l) => l.text);
  const need = lines.filter((l) => !l.romanization || l.romanizedHere);
  if (!entries.length || !need.length) return 0;
  const picks = new Map();
  if (entries.length === lines.length) {
    lines.forEach((l, i) => picks.set(l, entries[i].text));
  } else {
    for (const l of lines) {
      if (l.begin == null) continue;
      let best = null, bestD = Infinity;
      for (const e of entries) { const d = Math.abs(e.t - l.begin); if (d < bestD) { bestD = d; best = e; } }
      if (best && bestD < 1.2) picks.set(l, best.text);
    }
  }
  const hits = need.filter((l) => picks.has(l));
  // Too few lines line up: probably a different version of the song.
  if (hits.length < Math.max(1, need.length * 0.6)) return 0;
  for (const l of hits) {
    // Borrowed beats our own kana guess (it knows the kanji readings), but an
    // empty borrowed line doesn't replace anything.
    const text = picks.get(l).replace(/\s+/g, ' ').trim();
    if (text && /[a-z]/i.test(text)) { l.romanization = text; l.romanizedHere = true; }
  }
  model.hasRomanization = true;
  return hits.length;
}

/**
 * Looks the song up on NetEase and QQ Music and returns romanization entries
 * ([{ t, text }]) from the first good match, or null.
 * deps: { searchNetease, fetchNeteaseLyrics, searchQQ, fetchQQLyrics, qrcLines, lyricsMatch }
 */
export async function lookupRomanization({ title, artist = '', duration = 0 }, deps) {
  if (!title) return null;
  const q = [title, artist].filter(Boolean).join(' ');
  const song = { title, artist, duration };
  const ok = (r) => deps.lyricsMatch({ ...r, wordSync: true }, song) > 0;
  const tries = [
    async () => {
      const results = (await deps.searchNetease(q, 6)).filter(ok);
      for (const r of results.slice(0, 3)) {
        const p = await deps.fetchNeteaseLyrics(r.id).catch(() => null);
        const e = lrcEntries(p?.romalrc?.lyric || p?.yromalrc?.lyric);
        if (e.length) return e;
      }
      return null;
    },
    async () => {
      const results = (await deps.searchQQ(q, 6)).filter(ok);
      for (const r of results.slice(0, 3)) {
        const p = await deps.fetchQQLyrics(r.id).catch(() => null);
        if (!p?.roma) continue;
        const e = deps.qrcLines(p.roma).map((x) => ({ t: x.begin / 1000, text: x.words.map((w) => w.text).join('').replace(/\s+/g, ' ').trim() })).filter((x) => x.text);
        if (e.length) return e;
        const lrc = lrcEntries(p.roma);
        if (lrc.length) return lrc;
      }
      return null;
    },
  ];
  for (const t of tries) {
    const e = await t().catch(() => null);
    if (e?.length) return e;
  }
  return null;
}
