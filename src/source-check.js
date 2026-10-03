// "Check sources": tries each lyrics / artwork source once and reports which
// work. NetEase, QQ Music and Apple Music use private APIs or web pages that
// can change, so this shows at a glance when one breaks.

import { searchAmll, searchLrclib } from './lyrics-search.js';
import { searchNetease } from './netease.js';
import { searchQQ } from './qq-music.js';
import { searchBini } from './binilyrics.js';
import { searchAlbums, fetchMotionArt } from './apple-art.js';
import { appleMusicAvailable, appleMusicStatus, knownSignedIn } from './apple-music.js';

const TIMEOUT = 15000;

async function timed(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), TIMEOUT))]);
    if (detail && typeof detail === 'object' && detail.skipped) return { name, skipped: true, detail: detail.detail };
    return { name, ok: true, ms: Math.round(performance.now() - t0), detail: detail || '' };
  } catch (e) {
    return { name, ok: false, ms: Math.round(performance.now() - t0), detail: e.message };
  }
}

const need = (n, what) => { if (!n) throw new Error(`no ${what} returned`); return `${n} ${what}`; };

export const SOURCES = [
  ['AMLL TTML DB', async () => need((await searchAmll('love', 5)).length, 'results')],
  ['BiniLyrics', async () => need((await searchBini('love story taylor swift', 3)).length, 'results')],
  ['NetEase', async () => need((await searchNetease('love', 3)).length, 'results')],
  ['QQ Music', async () => need((await searchQQ('love', 3)).length, 'results')],
  ['LRCLIB', async () => need((await searchLrclib('love', 3)).length, 'results')],
  ['Apple covers (search)', async () => need((await searchAlbums('currents tame impala', { limit: 3 })).length, 'albums')],
  ['Apple animated covers', async () => { const m = await fetchMotionArt(1440838039); if (!m?.square) throw new Error('no animated cover found on a known album'); return 'found'; }],
  ['Apple Music lyrics', async () => {
    if (!appleMusicAvailable()) return { skipped: true, detail: 'desktop app only' };
    if (!knownSignedIn()) return { skipped: true, detail: 'not signed in' };
    const s = await appleMusicStatus({ refresh: true });
    if (!s.signedIn) throw new Error('sign-in expired');
    return `signed in (${s.storefront})`;
  }],
];

/** Runs every check; onResult(result, index) is called as each finishes. */
export async function checkSources(onResult) {
  return Promise.all(SOURCES.map(([name, fn], i) => timed(name, fn).then((r) => { onResult?.(r, i); return r; })));
}
