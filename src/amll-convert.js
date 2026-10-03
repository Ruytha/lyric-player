// Converts our parsed TTML model into AMLL's LyricLine[] format (pure; testable in Node).

const ms = (s) => Math.round(s * 1000);

/** Our parsed TTML model → AMLL LyricLine[] (times in ms). */
export function toAmllLines(model, { translation = true, romanization = true } = {}) {
  const out = [];
  const words = (part) => {
    if (part.mode !== 'word' || !part.words?.length) {
      // Line-timed: one span covering the line.
      return [{ word: part.text || part.words?.map((w) => w.text).join(' ') || '', startTime: ms(part.begin), endTime: ms(part.end) }];
    }
    const list = [];
    part.words.forEach((w, wi) => {
      const syls = w.syllables?.length ? w.syllables : [{ text: w.text, begin: w.begin, end: w.end }];
      syls.forEach((s, si) => {
        // AMLL keeps a word's syllables together and splits words on the trailing space
        // (none between CJK characters, which the source didn't separate).
        const next = part.words[wi + 1];
        const last = si === syls.length - 1 && !!next && next.spaceBefore !== false;
        list.push({ word: last ? `${s.text} ` : s.text, startTime: ms(s.begin), endTime: ms(s.end) });
      });
    });
    return list;
  };
  for (const l of model.lines) {
    if (l.begin == null) continue;
    out.push({
      words: words(l),
      translatedLyric: translation ? (l.translation || '') : '',
      romanLyric: romanization ? (l.romanization || '') : '',
      startTime: ms(l.begin),
      endTime: ms(l.end),
      isBG: false,
      isDuet: !!l.isDuet,
    });
    const bg = l.background;
    if (bg?.begin != null) {
      out.push({
        words: words(bg),
        translatedLyric: '',
        romanLyric: '',
        startTime: ms(bg.begin),
        endTime: ms(bg.end),
        isBG: true,
        isDuet: !!l.isDuet,
      });
    }
  }
  return out;
}
