// Apple Music lyrics from the user's own subscription (desktop app only).
// The app opens music.apple.com in its own window, where the user signs in on
// Apple's page; lyrics then come from the web player itself (see
// desktop/main.cjs). Nothing here sees the password or tokens.

const native = () => (typeof window !== 'undefined' ? window.lyricPlayerNative?.appleMusic : null);

/** Error messages from the main process arrive wrapped; unwrap them. */
export const unwrap = (e) => new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));

async function call(kind, params) {
  const fn = native();
  if (!fn) throw new Error('Apple Music lyrics need the desktop app');
  try { return await fn(kind, params); } catch (e) { throw unwrap(e); }
}

export const appleMusicAvailable = () => !!native();

// Remembered between runs so the Apple Music page only loads for people who
// signed in (it's a whole web player running in the background).
const FLAG = 'lyricplayer:appleSignedIn';
export function knownSignedIn() {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
}
function remember(on) {
  try { if (on) localStorage.setItem(FLAG, '1'); else localStorage.removeItem(FLAG); } catch { /* storage unavailable */ }
}

let status = null; // { signedIn, storefront }
let statusPromise = null;

/** { signedIn, storefront } (cached; refresh: true asks again). */
export async function appleMusicStatus({ refresh = false } = {}) {
  if (!appleMusicAvailable()) return { signedIn: false };
  if (status && !refresh) return status;
  if (!statusPromise || refresh) {
    statusPromise = call('status').then((s) => { remember(s.signedIn); return (status = s); }).finally(() => { statusPromise = null; });
  }
  return statusPromise;
}

export async function appleMusicSignIn() {
  await call('sign-in');
}

export async function appleMusicSignOut() {
  await call('sign-out');
  status = { signedIn: false };
  remember(false);
}

export async function searchAppleMusic(query) {
  if (!knownSignedIn()) return [];
  const s = await appleMusicStatus();
  if (!s.signedIn) return [];
  const songs = await call('search', { term: query });
  return songs.filter((x) => x.lyrics).map((x) => ({
    source: 'apple',
    id: x.id,
    title: x.title,
    artists: [x.artist].filter(Boolean),
    album: x.album || '',
    duration: x.duration,
    synced: x.synced,
    wordSync: null, // known once fetched (syllable lyrics or line lyrics)
  }));
}

export async function fetchAppleTtml(id) {
  const r = await call('lyrics', { id: String(id) });
  return r.ttml;
}
