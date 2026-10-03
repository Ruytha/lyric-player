// Plain text of a song's lyrics, kept with the song in the library so the
// library search can find songs by a line ("delete my twitter").

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** One line of text per <p>, without translations or romanization. */
export function lyricsPlainText(ttml) {
  const body = String(ttml || '').split(/<body[\s>]/i)[1] || '';
  const out = [];
  for (const m of body.matchAll(/<p[\s>][\s\S]*?<\/p>/gi)) {
    const text = decode(m[0]
      .replace(/<span[^>]*ttm:role="x-(translation|roman)[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (text) out.push(text);
  }
  return out.join('\n').slice(0, 20000);
}
