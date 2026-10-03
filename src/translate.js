// Translations for lyrics that don't have one (••• → Translate lyrics):
//  1. the browser's own on-device translator, when it has one (Chrome / Edge);
//  2. otherwise the website (api/translate.js, DeepL with the site owner's key).

const MAX_LINES = 300;

export const LANGUAGES = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['zh', 'Chinese'], ['id', 'Indonesian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['sv', 'Swedish'],
];

export const defaultLanguage = () => {
  const l = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return LANGUAGES.some(([k]) => k === l) ? l : 'en';
};

async function onDevice(texts, target) {
  const T = globalThis.Translator, D = globalThis.LanguageDetector;
  if (!T || !D) return null;
  try {
    const detector = await D.create();
    const [best] = await detector.detect(texts.join('\n').slice(0, 2000));
    const source = best?.detectedLanguage;
    if (!source || source === 'und') return null;
    if (source === target) return { same: true };
    if ((await T.availability({ sourceLanguage: source, targetLanguage: target })) === 'unavailable') return null;
    const tr = await T.create({ sourceLanguage: source, targetLanguage: target });
    const out = [];
    for (const t of texts) out.push(t.trim() ? await tr.translate(t) : '');
    return { lines: out, by: 'your browser' };
  } catch { return null; }
}

async function viaSite(texts, target, site) {
  const base = String(site || '').replace(/\/+$/, '').replace(/\/update\/[^/]+$/, '');
  const r = await fetch(`${base}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines: texts, target }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  if (!Array.isArray(body.lines) || body.lines.length !== texts.length) throw new Error('unexpected answer');
  return { lines: body.lines, by: 'DeepL', same: body.same };
}

/**
 * Fills line.translation for lines without one. Returns { count, by } or
 * { same: true } when the lyrics are already in that language.
 */
export async function translateModel(model, target, { site } = {}) {
  const lines = model.lines.filter((l) => !l.translation && String(l.text || '').trim()).slice(0, MAX_LINES);
  if (!lines.length) return { count: 0 };
  const texts = lines.map((l) => l.text);
  const res = (await onDevice(texts, target)) || (await viaSite(texts, target, site));
  if (res.same) return { same: true };
  lines.forEach((l, i) => {
    const t = String(res.lines[i] || '').trim();
    if (t && t.toLowerCase() !== l.text.trim().toLowerCase()) { l.translation = t; l.translatedHere = true; }
  });
  model.hasTranslation = model.lines.some((l) => l.translation);
  return { count: lines.filter((l) => l.translatedHere).length, by: res.by };
}
