// Edits timings in TTML text without rebuilding the document, so everything
// else (agents, translations, background vocals, formatting) stays as it was.
// Paragraphs are counted in document order, the same order parseTTML gives
// each line as `pIndex`.

import { parseTime } from './ttml-parser.js';

/** Seconds → TTML clock time ("mm:ss.mmm", or "h:mm:ss.mmm"). */
export function formatTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = (ms % 60000) / 1000;
  const ss = s.toFixed(3).padStart(6, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

const shiftAttrs = (text, delta) => text.replace(/(\s(?:begin|end)=")([^"]*)(")/g, (all, a, v, b) => {
  const t = parseTime(v);
  return t == null ? all : `${a}${formatTime(t + delta)}${b}`;
});

/**
 * Shifts paragraphs: shifts is Map|object of pIndex → seconds. Every begin/end
 * on the <p> and inside it moves by that amount.
 */
export function shiftParagraphs(ttml, shifts) {
  const map = shifts instanceof Map ? shifts : new Map(Object.entries(shifts).map(([k, v]) => [Number(k), v]));
  if (![...map.values()].some((v) => v)) return ttml;
  const open = /<((?:[\w-]+:)?p)(\s[^>]*?)?(\/?)>/g;
  let out = '', last = 0, index = 0, m;
  while ((m = open.exec(ttml))) {
    const name = m[1];
    const selfClosing = m[3] === '/';
    let end = m.index + m[0].length;
    if (!selfClosing) {
      const close = ttml.indexOf(`</${name}>`, end);
      end = close < 0 ? ttml.length : close + name.length + 3;
    }
    const delta = map.get(index) || 0;
    if (delta) {
      out += ttml.slice(last, m.index) + shiftAttrs(ttml.slice(m.index, end), delta);
      last = end;
    }
    open.lastIndex = end;
    index += 1;
  }
  return out + ttml.slice(last);
}
