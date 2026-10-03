// TTML → lyric data model. Pure module: no DOM access unless a DOMParser is
// available, in which case it's used for parsing (with a built-in fallback
// XML reader so the module also runs under `node --test`).
//
// Model:
// {
//   timing: 'word' | 'line' | 'none',
//   duration, meta: { title, artists[], album, songwriters[], ttmlAuthor },
//   agents: { [id]: { id, type, name } }, primaryAgent,
//   hasTranslation,
//   lines: [{
//     index, begin, end, agent, isBackground: false, isDuet, mode, songPart, key, text,
//     translation, words: [{ text, begin, end, syllables: [{ text, begin, end }] }],
//     background: { begin, end, isBackground: true, text, words } | null,
//   }],
//   interludes: [{ begin, end, afterLine, beforeLine }],
// }

export class TTMLParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TTMLParseError';
  }
}

export const INTERLUDE_MIN_GAP = 4;

// ---------------------------------------------------------------------------
// Time parsing

/**
 * Parse a TTML time expression into seconds.
 * Supports h:mm:ss.fff, mm:ss.fff, ss.fff, and offset forms 12.5s / 350ms / 2m / 1h.
 * Returns null for missing or unparseable values.
 */
export function parseTime(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;

  const offset = /^(\d*\.?\d+)(h|m|s|ms)$/.exec(s);
  if (offset) {
    const n = parseFloat(offset[1]);
    switch (offset[2]) {
      case 'h': return n * 3600;
      case 'm': return n * 60;
      case 's': return n;
      case 'ms': return n / 1000;
    }
  }

  const parts = s.split(':');
  if (parts.length > 3) return null;
  if (!parts.every((p) => /^\d*\.?\d+$/.test(p))) return null;
  let total = 0;
  for (const p of parts) total = total * 60 + parseFloat(p);
  return Number.isFinite(total) ? total : null;
}

// ---------------------------------------------------------------------------
// XML → lightweight tree { type: 'el', name, attrs, children } | { type: 'text', value }

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/** Minimal, strict-enough XML reader used when DOMParser isn't available. */
export function parseXmlLite(src) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const pushText = (value) => { if (value) top().children.push({ type: 'text', value }); };
  const openTag = /<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
  const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let i = 0;

  const lineOf = (pos) => src.slice(0, pos).split('\n').length;

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { pushText(decodeEntities(src.slice(i))); break; }
    if (lt > i) pushText(decodeEntities(src.slice(i, lt)));

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end === -1) throw new TTMLParseError(`Unclosed comment (line ${lineOf(lt)})`);
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end === -1) throw new TTMLParseError(`Unclosed CDATA section (line ${lineOf(lt)})`);
      pushText(src.slice(lt + 9, end));
      i = end + 3;
    } else if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end === -1) throw new TTMLParseError(`Unclosed processing instruction (line ${lineOf(lt)})`);
      i = end + 2;
    } else if (src.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset.
      let depth = 0, j = lt + 2;
      for (; j < src.length; j++) {
        if (src[j] === '[') depth++;
        else if (src[j] === ']') depth--;
        else if (src[j] === '>' && depth <= 0) break;
      }
      i = j + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      if (end === -1) throw new TTMLParseError(`Unterminated closing tag (line ${lineOf(lt)})`);
      const name = src.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.type !== 'el' || open.name !== name) {
        throw new TTMLParseError(
          `Mismatched closing tag </${name}> on line ${lineOf(lt)}` + (open?.name ? `, expected </${open.name}>` : ''),
        );
      }
      i = end + 1;
    } else {
      openTag.lastIndex = lt;
      const m = openTag.exec(src);
      if (!m) throw new TTMLParseError(`Malformed tag on line ${lineOf(lt)}`);
      const attrs = {};
      for (const a of m[2].matchAll(attrRe)) attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
      const el = { type: 'el', name: m[1], attrs, children: [] };
      top().children.push(el);
      if (!m[3]) stack.push(el);
      i = openTag.lastIndex;
    }
  }
  if (stack.length > 1) throw new TTMLParseError(`Unclosed element <${top().name}>`);
  const docEl = root.children.find((c) => c.type === 'el');
  if (!docEl) throw new TTMLParseError('No root element found');
  return docEl;
}

function fromDom(node) {
  if (node.nodeType === 1) {
    const attrs = {};
    for (const a of node.attributes) attrs[a.name] = a.value;
    return { type: 'el', name: node.nodeName, attrs, children: Array.from(node.childNodes, fromDom).filter(Boolean) };
  }
  if (node.nodeType === 3 || node.nodeType === 4) return { type: 'text', value: node.nodeValue };
  return null;
}

export function parseXml(text) {
  if (typeof globalThis.DOMParser === 'function') {
    const doc = new globalThis.DOMParser().parseFromString(text, 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) {
      const msg = (err.textContent || '')
        .replace(/This page contains the following errors:/i, '')
        .replace(/Below is a rendering of the page.*$/is, '')
        .replace(/\s+/g, ' ')
        .trim();
      throw new TTMLParseError(msg ? `Invalid XML: ${msg.slice(0, 200)}` : 'Invalid XML');
    }
    return fromDom(doc.documentElement);
  }
  return parseXmlLite(text);
}

// ---------------------------------------------------------------------------
// Tree helpers (namespace-prefix agnostic: match by local name)

const local = (name) => { const i = name.indexOf(':'); return i === -1 ? name : name.slice(i + 1); };

function attr(el, name) {
  if (name in el.attrs) return el.attrs[name];
  for (const k in el.attrs) if (local(k) === name) return el.attrs[k];
  return null;
}

const elements = (el) => el.children.filter((c) => c.type === 'el');
const child = (el, name) => elements(el).find((c) => local(c.name) === name) ?? null;

function* descendants(el, name) {
  for (const c of elements(el)) {
    if (local(c.name) === name) yield c;
    yield* descendants(c, name);
  }
}

function textContent(el) {
  if (el.type === 'text') return el.value;
  return el.children.map(textContent).join('');
}

// ---------------------------------------------------------------------------
// Word / syllable building

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;

/**
 * Turns a token stream (timed syllables + raw text) into words.
 * Adjacent syllables with no whitespace between them join into one word.
 * word.spaceBefore says whether whitespace separated it from the previous
 * word (CJK characters are split into words without one).
 */
function buildWords(tokens) {
  const words = [];
  let current = null;
  let sawSpace = false;
  const brk = () => { current = null; };
  const push = (text, begin, end) => {
    if (!text) return;
    if (current) {
      const last = current.syllables[current.syllables.length - 1].text;
      // CJK text has no spaces; let each character group wrap independently.
      if (CJK.test(text[0]) || CJK.test(last[last.length - 1])) brk();
    }
    if (!current) {
      current = { syllables: [], spaceBefore: words.length > 0 && sawSpace };
      words.push(current);
    }
    sawSpace = false;
    current.syllables.push({ text, begin, end });
  };

  for (const tok of tokens) {
    const pieces = tok.text.split(/(\s+)/);
    // Distribute a span's time across its non-space pieces by character count.
    const chars = pieces.reduce((n, p) => (p && !/^\s+$/.test(p) ? n + p.length : n), 0);
    let cursor = tok.begin;
    const dur = tok.begin != null && tok.end != null ? tok.end - tok.begin : null;
    for (const p of pieces) {
      if (!p) continue;
      if (/^\s+$/.test(p)) { brk(); sawSpace = true; continue; }
      if (dur == null) { push(p, null, null); continue; }
      const end = cursor + (dur * p.length) / chars;
      push(p, cursor, end);
      cursor = end;
    }
  }
  return words;
}

/** Line text: words joined with a space only where the source had one. */
export function joinWords(words) {
  return words.map((w, i) => (i > 0 && w.spaceBefore !== false ? ' ' : '') + w.text).join('');
}

function finalizeWords(words, lineBegin, lineEnd, mode) {
  const syls = words.flatMap((w) => w.syllables);
  if (mode === 'word') {
    // Fill gaps in syllable timing from neighbours.
    for (let i = 0; i < syls.length; i++) {
      const s = syls[i];
      if (s.begin == null) s.begin = i > 0 ? syls[i - 1].end : lineBegin;
      if (s.end == null) {
        const next = syls.slice(i + 1).find((n) => n.begin != null);
        s.end = next ? next.begin : lineEnd;
      }
      if (s.end < s.begin) s.end = s.begin;
    }
  } else {
    for (const s of syls) { s.begin = lineBegin; s.end = lineEnd; }
  }
  for (const w of words) {
    w.text = w.syllables.map((s) => s.text).join('');
    w.begin = w.syllables[0].begin;
    w.end = w.syllables[w.syllables.length - 1].end;
  }
  return words;
}

function stripParens(words) {
  if (!words.length) return words;
  const first = words[0].syllables[0];
  first.text = first.text.replace(/^[(（]/, '');
  const lastWord = words[words.length - 1];
  const last = lastWord.syllables[lastWord.syllables.length - 1];
  last.text = last.text.replace(/[)）]$/, '');
  for (const w of words) w.syllables = w.syllables.filter((s) => s.text);
  return words.filter((w) => w.syllables.length);
}

function minMax(syls) {
  let begin = null, end = null;
  for (const s of syls) {
    if (s.begin != null && (begin == null || s.begin < begin)) begin = s.begin;
    if (s.end != null && (end == null || s.end > end)) end = s.end;
  }
  return { begin, end };
}

// ---------------------------------------------------------------------------
// Interludes

/** Gaps ≥ minGap seconds before the first line and between lines. */
export function computeInterludes(lines, minGap = INTERLUDE_MIN_GAP) {
  const out = [];
  let prevEnd = 0, prevIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.begin == null) continue;
    if (l.begin - prevEnd >= minGap) out.push({ begin: prevEnd, end: l.begin, afterLine: prevIdx, beforeLine: i });
    const end = Math.max(l.end ?? l.begin, l.background?.end ?? 0);
    if (end > prevEnd) prevEnd = end;
    prevIdx = i;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry

export function parseTTML(text) {
  if (typeof text !== 'string' || !text.trim()) throw new TTMLParseError('The TTML file is empty');
  const root = parseXml(text.replace(/^﻿/, ''));
  if (local(root.name) !== 'tt') throw new TTMLParseError(`Not a TTML document (root element is <${root.name}>)`);

  const head = child(root, 'head');
  const body = child(root, 'body');
  if (!body) throw new TTMLParseError('TTML has no <body>');

  // Agents & metadata
  const agents = {};
  const meta = { title: null, artists: [], album: null, songwriters: [], ttmlAuthor: null };
  const headTranslations = {};
  const headRoman = {};
  if (head) {
    for (const a of descendants(head, 'agent')) {
      const id = attr(a, 'id');
      if (!id) continue;
      const nameEl = child(a, 'name');
      agents[id] = { id, type: (attr(a, 'type') || 'person').toLowerCase(), name: nameEl ? textContent(nameEl).trim() : null };
    }
    const title = descendants(head, 'title').next().value;
    if (title) meta.title = textContent(title).trim() || null;
    // AMLL-style <amll:meta key="musicName" value="..."/>
    for (const m of descendants(head, 'meta')) {
      const key = attr(m, 'key'), value = attr(m, 'value');
      if (!key || !value) continue;
      if (key === 'musicName' && !meta.title) meta.title = value;
      else if (key === 'artists') meta.artists.push(value);
      else if (key === 'album' && !meta.album) meta.album = value;
      else if (/^(songwriters?|lyricists?|composers?)$/i.test(key)) meta.songwriters.push(...value.split(/\s*[,;/、]\s*/));
      else if (key === 'ttmlAuthorGithubLogin' && !meta.ttmlAuthor) meta.ttmlAuthor = value;
    }
    // Apple Music: <iTunesMetadata><songwriters><songwriter>Name</songwriter>…
    for (const w of descendants(head, 'songwriter')) meta.songwriters.push(textContent(w).trim());
    meta.songwriters = [...new Set(meta.songwriters.filter(Boolean))];
    // Apple-style <translations><translation><text for="L1">…</text></translation></translations>
    for (const tr of descendants(head, 'translation')) {
      for (const t of descendants(tr, 'text')) {
        const key = attr(t, 'for');
        if (key) headTranslations[key] = textContent(t).trim();
      }
    }
    // …and romanization: <transliterations><transliteration><text for="L1">
    for (const tr of descendants(head, 'transliteration')) {
      for (const t of descendants(tr, 'text')) {
        const key = attr(t, 'for');
        if (key) headRoman[key] = textContent(t).replace(/\s+/g, ' ').trim();
      }
    }
  }

  // Collect <p> elements with their song-part.
  const paragraphs = [];
  const walkBody = (el, songPart) => {
    for (const c of elements(el)) {
      const name = local(c.name);
      if (name === 'p') paragraphs.push({ p: c, songPart });
      else walkBody(c, attr(c, 'song-part') || songPart);
    }
  };
  walkBody(body, attr(body, 'song-part'));

  // Tokenize each paragraph.
  const raw = paragraphs.map(({ p, songPart }, pIndex) => {
    const main = [], bg = [];
    let translation = null, romanization = null;
    const walk = (nodes, target) => {
      for (const n of nodes) {
        if (n.type === 'text') { target.push({ text: n.value, begin: null, end: null }); continue; }
        const name = local(n.name);
        if (name === 'br') { target.push({ text: ' ', begin: null, end: null }); continue; }
        if (name !== 'span') { walk(n.children, target); continue; }
        const role = attr(n, 'role');
        if (role === 'x-bg') walk(n.children, bg);
        else if (role === 'x-translation') translation = textContent(n).trim() || translation;
        else if (role === 'x-roman' || role === 'x-romanization') romanization = textContent(n).trim() || romanization;
        else if (elements(n).length) walk(n.children, target);
        else target.push({ text: textContent(n), begin: parseTime(attr(n, 'begin')), end: parseTime(attr(n, 'end')) });
      }
    };
    walk(p.children, main);
    return {
      p, pIndex, songPart, main, bg, translation, romanization,
      begin: parseTime(attr(p, 'begin')), end: parseTime(attr(p, 'end')),
      agent: attr(p, 'agent'), key: attr(p, 'key'),
    };
  });

  // Document timing mode.
  const declared = (attr(root, 'timing') || '').toLowerCase();
  const anySylTimed = raw.some((r) => r.main.some((t) => t.begin != null) || r.bg.some((t) => t.begin != null));
  const anyLineTimed = raw.some((r) => r.begin != null);
  let timing;
  if (declared === 'none') timing = 'none';
  else if (declared === 'line') timing = anyLineTimed || anySylTimed ? 'line' : 'none';
  else if (declared === 'word') timing = anySylTimed ? 'word' : anyLineTimed ? 'line' : 'none';
  else timing = anySylTimed ? 'word' : anyLineTimed ? 'line' : 'none';

  const lines = [];
  for (const r of raw) {
    const words = buildWords(r.main);
    let bgWords = stripParens(buildWords(r.bg));
    if (!words.length && !bgWords.length) continue;

    const mainSyls = words.flatMap((w) => w.syllables);
    const bgSyls = bgWords.flatMap((w) => w.syllables);
    const sylRange = minMax(mainSyls);
    const hasSylTiming = mainSyls.some((s) => s.begin != null);

    let mode;
    if (timing === 'none') mode = 'none';
    else if (timing === 'word' && hasSylTiming) mode = 'word';
    else mode = r.begin != null || sylRange.begin != null ? 'line' : 'none';

    let begin = r.begin ?? sylRange.begin;
    let end = r.end ?? sylRange.end;
    if (mode === 'none') begin = end = null;
    else if (end == null || end < begin) end = begin;

    finalizeWords(words, begin, end, mode);

    let background = null;
    if (bgWords.length) {
      const bgRange = minMax(bgSyls);
      const bgMode = mode === 'word' && bgSyls.some((s) => s.begin != null) ? 'word' : mode;
      const bBegin = bgMode === 'none' ? null : bgRange.begin ?? begin;
      const bEnd = bgMode === 'none' ? null : bgRange.end ?? end;
      finalizeWords(bgWords, bBegin, bEnd, bgMode);
      background = {
        begin: bBegin, end: bEnd, isBackground: true, mode: bgMode,
        text: joinWords(bgWords), words: bgWords,
      };
    }

    // Main line with only background vocals: promote timing from them.
    if (!words.length && background) { begin = background.begin; end = background.end; }

    lines.push({
      index: lines.length,
      pIndex: r.pIndex,
      begin, end,
      agent: r.agent || null,
      isBackground: false,
      isDuet: false,
      mode,
      songPart: r.songPart || null,
      key: r.key || null,
      text: joinWords(words),
      translation: r.translation ?? (r.key ? headTranslations[r.key] ?? null : null),
      romanization: r.romanization ?? (r.key ? headRoman[r.key] ?? null : null),
      words,
      background,
    });
  }

  // Duets: the first "person" agent to sing is primary (left);
  // other person agents are right-aligned; groups/others stay left.
  const agentType = (id) => agents[id]?.type ?? 'person';
  const primaryAgent = lines.find((l) => l.agent && agentType(l.agent) === 'person')?.agent ?? null;
  for (const l of lines) {
    l.isDuet = !!(l.agent && primaryAgent && l.agent !== primaryAgent && agentType(l.agent) === 'person');
  }

  const lastEnd = lines.reduce((m, l) => Math.max(m, l.end ?? 0, l.background?.end ?? 0), 0);
  const duration = parseTime(attr(body, 'dur')) ?? (lastEnd || null);

  return {
    timing,
    duration,
    meta,
    agents,
    primaryAgent,
    hasTranslation: lines.some((l) => l.translation),
    hasRomanization: lines.some((l) => l.romanization),
    lines,
    interludes: timing === 'none' ? [] : computeInterludes(lines),
  };
}
