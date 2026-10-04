// Desktop wrapper: runs the lyric player in its own window (Electron).
//
// The web app is served from a private app:// origin rather than file://, so
// ES modules load normally and the song library (IndexedDB) has a stable home.

const { app, BrowserWindow, protocol, shell, Menu, ipcMain, session, dialog, clipboard, Tray, nativeImage, globalShortcut } = require('electron');
const { RemoteServer } = require('./remote-server.cjs');
const { DiscordPresence } = require('./discord-rpc.cjs');
const { MusicFolders } = require('./music-folders.cjs');
const { LastFm } = require('./lastfm.cjs');
const { SystemMedia } = require('./system-media.cjs');
const { WebUpdate } = require('./web-update.cjs');
const { DesktopPrefs } = require('./desktop-prefs.cjs');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

// Web files: the repo root while developing, bundled resources once packaged.
// The player pages are served from an in-app update when there is one
// (web-update.cjs); the main-process relays always use the installed files.
const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..');
let webUpdate = null;
const pageRoot = () => webUpdate?.root || WEB_ROOT;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ttml': 'application/ttml+xml',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// Smooth animation: rasterize on the GPU, use it even if it's on Chromium's
// blocklist, prefer the discrete GPU, and never throttle when in the background.
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  // Songs from the user's music folders (see music-folders.cjs).
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, bypassCSP: true } },
]);

// NetEase lyrics relay (the page can't call NetEase directly). Only the search
// and lyric endpoints are allowed; the allow-list lives in src/netease.js.
function relayNetease() {
  let mod = null;
  ipcMain.handle('netease', async (event, kind, params) => {
    if (!event.senderFrame?.url.startsWith('app://')) throw new Error('not allowed');
    mod ??= await import(pathToFileURL(path.join(WEB_ROOT, 'src', 'netease.js')).href);
    const url = mod.neteaseUpstreamUrl(kind, params || {});
    const r = await fetch(url, {
      headers: {
        Referer: 'https://music.163.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      },
    });
    if (!r.ok) throw new Error(`NetEase HTTP ${r.status}`);
    return r.json();
  });
}

const fromApp = (event) => !!event.senderFrame?.url.startsWith('app://');

// Windows can be gone (or going) while events still arrive, especially when
// the app is closing; only talk to ones that are still alive.
const alive = (w) => !!w && !w.isDestroyed() && !w.webContents.isDestroyed();
const appWindows = () => BrowserWindow.getAllWindows().filter((w) => alive(w) && w.webContents.getURL().startsWith('app://'));
function sendTo(w, channel, payload) {
  if (!alive(w)) return;
  try { w.webContents.send(channel, payload); } catch { /* closed meanwhile */ }
}
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

// QQ Music lyrics relay; the allow-list lives in src/qq-music.js.
function relayQQMusic() {
  let mod = null;
  ipcMain.handle('qq-music', async (event, kind, params) => {
    if (!fromApp(event)) throw new Error('not allowed');
    mod ??= await import(pathToFileURL(path.join(WEB_ROOT, 'src', 'qq-music.js')).href);
    const { url, body } = mod.qqUpstreamRequest(kind, params || {});
    const r = await fetch(url, { method: 'POST', headers: mod.QQ_HEADERS, body });
    if (!r.ok) throw new Error(`QQ Music HTTP ${r.status}`);
    return r.json();
  });
}

// ---------------------------------------------------------------------------
// Apple Music lyrics with the user's own subscription.
//
// music.apple.com runs in its own window and session ("persist:apple-music").
// The user signs in there themselves, on Apple's page; the app never sees the
// password or the tokens. Lyrics are requested by running a call to the web
// player's own MusicKit inside that page, the same request it makes when you
// open lyrics there.

let amWin = null;
let amReady = null;
let quitting = false;
app.on('before-quit', () => { quitting = true; prefs?.flush(); });

function appleMusicWindow() {
  if (alive(amWin)) return amReady;
  amWin = new BrowserWindow({
    width: 1100,
    height: 780,
    show: false,
    title: 'Apple Music: sign in',
    autoHideMenuBar: true,
    backgroundColor: '#1f1f1f',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { partition: 'persist:apple-music', sandbox: true, contextIsolation: true, spellcheck: false },
  });
  amWin.webContents.setUserAgent(CHROME_UA);
  // Apple's sign-in opens in a popup on apple.com; anything else opens in the browser.
  amWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([\w-]+\.)*apple\.com\//i.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { partition: 'persist:apple-music', sandbox: true, contextIsolation: true } } };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Closing it only hides it, so lyrics keep working.
  amWin.on('close', (e) => { if (!quitting && alive(amWin)) { e.preventDefault(); amWin.hide(); } });
  amWin.on('closed', () => { amWin = null; });
  amReady = amWin.loadURL('https://music.apple.com/us/browse').then(() => waitForMusicKit());
  amReady.catch(() => { if (alive(amWin)) amWin.destroy(); amWin = null; });
  return amReady;
}

async function waitForMusicKit() {
  for (let i = 0; i < 60; i++) {
    const ok = await amWin.webContents.executeJavaScript('!!(window.MusicKit && MusicKit.getInstance && MusicKit.getInstance())').catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Apple Music did not load');
}

async function inAppleMusic(code) {
  await appleMusicWindow();
  return amWin.webContents.executeJavaScript(`(async () => { const mk = MusicKit.getInstance(); ${code} })()`);
}

function relayAppleMusic() {
  ipcMain.handle('apple-music', async (event, kind, params = {}) => {
    if (!fromApp(event)) throw new Error('not allowed');
    if (kind === 'status') {
      return inAppleMusic('return { signedIn: !!mk.isAuthorized, storefront: mk.storefrontId || "us" };');
    }
    if (kind === 'sign-in') {
      await appleMusicWindow();
      amWin.show();
      amWin.focus();
      // Opens Apple's own sign-in if not signed in yet.
      inAppleMusic('if (!mk.isAuthorized) { try { await mk.authorize(); } catch {} } return true;').catch(() => {});
      return true;
    }
    if (kind === 'sign-out') {
      await inAppleMusic('try { await mk.unauthorize(); } catch {} return true;').catch(() => {});
      await session.fromPartition('persist:apple-music').clearStorageData();
      if (alive(amWin)) amWin.destroy();
      amWin = null;
      return true;
    }
    if (kind === 'search') {
      const term = String(params.term || '').slice(0, 200).trim();
      if (!term) throw new Error('missing query');
      return inAppleMusic(`
        const sf = mk.storefrontId || 'us';
        const r = await mk.api.music('/v1/catalog/' + sf + '/search', { term: ${JSON.stringify(term)}, types: 'songs', limit: 10 });
        return (r.data.results.songs?.data || []).map((s) => ({ id: s.id, title: s.attributes.name, artist: s.attributes.artistName, album: s.attributes.albumName,
          duration: (s.attributes.durationInMillis || 0) / 1000, lyrics: !!s.attributes.hasLyrics, synced: !!s.attributes.hasTimeSyncedLyrics }));`);
    }
    if (kind === 'lyrics') {
      const id = String(params.id || '');
      if (!/^\d{1,15}$/.test(id)) throw new Error('bad id');
      // The page returns { error } rather than throwing, so the message survives.
      const r = await inAppleMusic(`
        if (!mk.isAuthorized) return { error: 'sign in to Apple Music first (Settings > Apple Music)' };
        const sf = mk.storefrontId || 'us';
        // As the web player asks: newer answers carry the TTML in ttmlLocalizations.
        const lang = (navigator.language || 'en-US');
        const why = [];
        for (const kind of ['syllable-lyrics', 'lyrics']) {
          try {
            const r = await mk.api.music('/v1/catalog/' + sf + '/songs/' + ${JSON.stringify(id)} + '/' + kind, { 'l[lyrics]': lang, extend: 'ttmlLocalizations' });
            const a = r.data?.data?.[0]?.attributes || {};
            const ttml = a.ttml || a.ttmlLocalizations;
            if (typeof ttml === 'string' && ttml.trim()) return { ttml, word: kind === 'syllable-lyrics' };
            why.push(kind + ': ' + (r.status || 'empty'));
          } catch (e) {
            const status = e?.status || e?.data?.status;
            if (e?.errorCode === 'UNAUTHORIZED' || status === 401) return { error: 'Apple Music sign-in expired; sign in again (Settings > Apple Music)' };
            if (status === 403) return { error: 'Apple Music says this account can’t play this song (subscription or region)' };
            why.push(kind + ': ' + (status || e?.errorCode || e?.message || e));
          }
        }
        return { error: 'Apple Music has no lyrics for this song (' + why.join(', ') + ')' };`);
      if (r?.error) throw new Error(r.error);
      return r;
    }
    throw new Error('unknown request');
  });
}

// ---------------------------------------------------------------------------
// Discord Rich Presence. The page sends the activity; animated covers come
// from the user's website as GIFs, which we fetch once first so Discord
// doesn't time out while the GIF is being made.

const presence = new DiscordPresence({ log: (m) => console.log(m) });
const warmed = new Map(); // gif url -> 'ok' | 'pending' | 'failed'
let lastPresence = null;

function clean(s, max = 128) {
  const t = String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  return t.length === 1 ? `${t}\u2800` : t; // Discord wants at least 2 characters
}

function buildActivity(p) {
  const a = p.activity || {};
  const activity = { type: 2, status_display_type: 2, instance: false };
  if (clean(a.details)) activity.details = clean(a.details);
  if (clean(a.state)) activity.state = clean(a.state);
  if (Number.isFinite(a.start) && Number.isFinite(a.end)) activity.timestamps = { start: Math.round(a.start), end: Math.round(a.end) };
  let image = typeof a.image === 'string' && /^https:\/\//.test(a.image) ? a.image.slice(0, 256) : null;
  const gif = typeof p.animated === 'string' && /^https:\/\//.test(p.animated) ? p.animated.slice(0, 256) : null;
  if (gif) {
    const state = warmed.get(gif);
    if (state === 'ok') image = gif;
    else if (!state) {
      warmed.set(gif, 'pending');
      fetch(gif, { signal: AbortSignal.timeout(60000) })
        .then((r) => { warmed.set(gif, r.ok && /gif/.test(r.headers.get('content-type') || '') ? 'ok' : 'failed'); })
        .catch(() => warmed.set(gif, 'failed'))
        .finally(() => { if (lastPresence) presence.set(lastPresence.clientId, buildActivity(lastPresence)); });
    }
  }
  if (image) {
    activity.assets = { large_image: image };
    if (clean(a.imageText)) activity.assets.large_text = clean(a.imageText);
  }
  return activity;
}

function relayDiscord() {
  ipcMain.handle('discord', (event, payload) => {
    if (!fromApp(event)) return 'off';
    if (!payload || !/^\d{15,22}$/.test(String(payload.clientId || ''))) {
      lastPresence = null;
      presence.stop();
      return presence.status;
    }
    lastPresence = payload;
    presence.set(String(payload.clientId), payload.activity ? buildActivity(payload) : null);
    return presence.status;
  });
  app.on('before-quit', () => presence.stop());
}

// ---------------------------------------------------------------------------
// Music folders

let folders = null;

function relayMusicFolders() {
  folders = new MusicFolders(app);
  if (process.env.LP_SELFTEST_FOLDER) folders.folders = [process.env.LP_SELFTEST_FOLDER];
  folders.watch();
  folders.onChange = () => { for (const w of appWindows()) sendTo(w, 'library-changed'); };
  protocol.handle('media', (request) => folders.serve(request));
  ipcMain.handle('music', async (event, kind, params = {}) => {
    if (!fromApp(event)) throw new Error('not allowed');
    if (kind === 'folders') return folders.folders;
    if (kind === 'add-folder') {
      const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), { title: 'Add a music folder', properties: ['openDirectory', 'multiSelections'] });
      if (r.canceled) return null;
      for (const dir of r.filePaths) folders.add(dir);
      return folders.folders;
    }
    if (kind === 'remove-folder') { folders.remove(String(params.folder || '')); return folders.folders; }
    if (kind === 'scan') return folders.scan();
    const file = String(params.path || '');
    if (!folders.allowed(file)) throw new Error('not in your music folders');
    if (kind === 'track-info') {
      const t = await folders.tags(file, { covers: true });
      return { ...t, picture: t.picture ? { format: t.picture.format, data: new Uint8Array(t.picture.data) } : null };
    }
    if (kind === 'read-ttml') {
      if (!/\.ttml$/i.test(file)) throw new Error('not a TTML file');
      return fs.readFile(file, 'utf8');
    }
    if (kind === 'write-ttml') {
      if (!/\.ttml$/i.test(file)) throw new Error('not a TTML file');
      await fs.writeFile(file, String(params.text || ''), 'utf8');
      return true;
    }
    if (kind === 'show') { shell.showItemInFolder(file); return true; }
    throw new Error('unknown request');
  });
}

// ---------------------------------------------------------------------------
// Last.fm scrobbling (see lastfm.cjs)

function relayLastFm() {
  const lastfm = new LastFm(app, shell);
  ipcMain.handle('lastfm', async (event, kind, params = {}) => {
    if (!fromApp(event)) throw new Error('not allowed');
    const keys = { apiKey: String(params.apiKey || ''), secret: String(params.secret || '') };
    if (kind === 'status') return lastfm.status(keys.apiKey);
    if (kind === 'connect') return lastfm.connect(keys);
    if (kind === 'disconnect') return lastfm.disconnect();
    if (kind === 'now-playing') return lastfm.nowPlaying(params.track || {}, keys);
    if (kind === 'scrobble') return lastfm.scrobble(params.track || {}, keys);
    throw new Error('unknown request');
  });
}

// ---------------------------------------------------------------------------
// Updates (electron-updater). Builds published to GitHub Releases update
// themselves; see "Updates" in README.md for setting up the publish target.

// Updates, two kinds:
//  - in-app ("web") updates of the player from your website: no reinstall,
//    used from the next start (web-update.cjs);
//  - full app updates (a new installer) with electron-updater from GitHub
//    Releases, for changes to the desktop shell, when set up.
// The page asks; progress goes to every player window as 'update-status'.

let bootTimer = null;
let bootedThisLoad = false;

/** An updated page that doesn't start within 20 s is rolled back. */
function watchUpdatedPage(w) {
  // The page can say it booted before loading finishes; remember that.
  w.webContents.on('did-start-loading', () => { bootedThisLoad = false; });
  w.webContents.on('did-finish-load', () => {
    clearTimeout(bootTimer);
    if (!webUpdate?.usingUpdate || process.env.LP_SELFTEST || bootedThisLoad) return;
    bootTimer = setTimeout(() => {
      if (webUpdate.markBad() && alive(w)) w.webContents.reloadIgnoringCache();
    }, 20000);
  });
  w.webContents.on('render-process-gone', () => {
    if (webUpdate?.usingUpdate && webUpdate.markBad() && alive(w)) w.webContents.reloadIgnoringCache();
  });
}

function relayUpdates() {
  let updater = null;
  let last = { state: 'idle' };
  let pendingWeb = null; // manifest of an available in-app update
  const send = (s) => {
    last = s;
    for (const w of appWindows()) sendTo(w, 'update-status', s);
    return s;
  };
  const get = () => {
    if (updater) return updater;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => send({ state: 'checking', kind: 'app' }));
    updater.on('update-available', (i) => send({ state: 'available', kind: 'app', version: i.version }));
    updater.on('update-not-available', () => send({ state: 'none', kind: 'app', version: app.getVersion() }));
    updater.on('download-progress', (p) => send({ state: 'downloading', kind: 'app', percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (i) => send({ state: 'ready', kind: 'app', version: i.version }));
    updater.on('error', (e) => send(/app-update\.yml|ENOENT|No published versions|404/.test(String(e?.message)) ? { state: 'not-configured', kind: 'app' } : { state: 'error', kind: 'app', message: String(e?.message || e).split('\n')[0].slice(0, 200) }));
    return updater;
  };
  const appConfigured = () => app.isPackaged && require('node:fs').existsSync(path.join(process.resourcesPath, 'app-update.yml'));

  async function downloadWeb() {
    if (!pendingWeb) return last;
    send({ state: 'downloading', kind: 'web', version: pendingWeb.version, percent: 0 });
    try {
      const r = await webUpdate.download(pendingWeb, (percent) => send({ state: 'downloading', kind: 'web', version: pendingWeb.version, percent }));
      pendingWeb = null;
      return send({ ...r, kind: 'web' });
    } catch (e) {
      return send({ state: 'error', kind: 'web', message: e.message });
    }
  }

  async function check({ site, auto }) {
    let web = null;
    if (site) {
      send({ state: 'checking', kind: 'web' });
      try {
        web = await webUpdate.check(site);
      } catch (e) {
        if (!appConfigured()) return send({ state: 'error', kind: 'web', message: e.message });
      }
      if (web?.state === 'available') {
        pendingWeb = web.manifest;
        if (auto) return downloadWeb();
        return send({ state: 'available', kind: 'web', version: web.version });
      }
      if (web?.state === 'ready') return send({ state: 'ready', kind: 'web', version: web.version });
    }
    if (appConfigured()) { await get().checkForUpdates().catch(() => {}); return last; }
    if (web?.state === 'needs-app') return send({ state: 'needs-app', kind: 'web', version: web.version, minApp: web.minApp });
    if (web) return send({ state: 'none', kind: 'web', version: webUpdate.version() });
    return send({ state: app.isPackaged ? 'not-configured' : 'dev' });
  }

  ipcMain.handle('update', async (event, kind, params = {}) => {
    if (!fromApp(event)) throw new Error('not allowed');
    if (kind === 'version') {
      const web = webUpdate?.version();
      return web && webUpdate.usingUpdate ? `${web} (app ${app.getVersion()})` : app.getVersion();
    }
    if (kind === 'booted') { bootedThisLoad = true; clearTimeout(bootTimer); return true; }
    if (kind === 'versions') return { current: webUpdate.version(), usingUpdate: webUpdate.usingUpdate, previous: webUpdate.previousVersion() };
    if (kind === 'rollback') {
      const v = await webUpdate.rollback();
      for (const w of appWindows()) w.webContents.reloadIgnoringCache();
      return send({ state: 'none', kind: 'web', version: v });
    }
    if (kind === 'status') return last;
    if (kind === 'check') return check({ site: typeof params.site === 'string' ? params.site : '', auto: !!params.auto });
    if (kind === 'download') {
      if (last.kind === 'web') return downloadWeb();
      if (appConfigured()) { get().downloadUpdate().catch(() => {}); }
      return last;
    }
    if (kind === 'install') {
      if (last.kind === 'web') {
        // Switch to the downloaded files and reload: no restart needed.
        webUpdate.apply();
        for (const w of appWindows()) w.webContents.reloadIgnoringCache();
        return send({ state: 'none', kind: 'web', version: webUpdate.version() });
      }
      if (appConfigured()) { quitting = true; get().quitAndInstall(); }
      return last;
    }
    throw new Error('unknown request');
  });
  // Full app updates are checked quietly a little after start (the page asks
  // for in-app updates itself, since it knows your website).
  if (appConfigured() && !process.env.LP_SELFTEST) setTimeout(() => get().checkForUpdates().catch(() => {}), 15000);
}

// ---------------------------------------------------------------------------
// Mac: real Liquid Glass (macOS 26), an NSGlassEffectView behind a window's
// web page, from the electron-liquid-glass add-on. Older macOS gets the
// regular blur instead; Windows doesn't load it at all.

const IS_MAC = process.platform === 'darwin';
let liquidGlass;
function glassModule() {
  if (liquidGlass !== undefined) return liquidGlass;
  liquidGlass = null;
  if (!IS_MAC) return null;
  try {
    const m = require('electron-liquid-glass');
    liquidGlass = m.default || m;
  } catch (e) {
    console.log(`[glass] not available: ${e.message}`);
  }
  return liquidGlass;
}
const glassSupported = () => { try { return !!glassModule()?.isGlassSupported(); } catch { return false; } };

/** Puts glass behind the window's page once it has loaded (it stays across reloads). */
function addGlass(w, { cornerRadius = 0, tint = '' } = {}) {
  const lg = glassModule();
  if (!lg) return;
  w.webContents.once('did-finish-load', () => {
    if (!alive(w)) return;
    try {
      const id = lg.addView(w.getNativeWindowHandle(), { cornerRadius, ...(tint ? { tintColor: tint } : {}) });
      if (id < 0) console.log('[glass] not added');
    } catch (e) { console.log(`[glass] ${e.message}`); }
  });
}

function relayGlass() {
  ipcMain.handle('glass', (event, kind) => {
    if (!fromApp(event)) return false;
    if (kind === 'supported') return IS_MAC && glassSupported();
    return false;
  });
}

// ---------------------------------------------------------------------------
// Mini player: a small always-on-top window with the current line. The main
// window sends it the state; its buttons send commands back.

let mini = null;
let bar = null;

/** Floating lyrics: transparent, on top of everything, clicks pass through while locked. */
function openBar() {
  if (alive(bar)) { bar.showInactive(); return; }
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  const saved = prefs.get('barBounds');
  const width = Math.min(960, area.width - 40), height = 150;
  // Where it was last time, if that's still on a screen.
  const onScreen = (b) => screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y >= a.y - 20 && b.y < a.y + a.height - 40);
  const bounds = saved && saved.width > 100 && saved.height > 40 && onScreen(saved)
    ? saved
    : { width, height, x: Math.round(area.x + (area.width - width) / 2), y: area.y + area.height - height - 24 };
  const locked = prefs.get('barLocked') !== false;
  bar = new BrowserWindow({
    ...bounds, minWidth: 360, minHeight: 90,
    frame: false, transparent: true, alwaysOnTop: true, resizable: true, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, focusable: true, hasShadow: false, backgroundColor: '#00000000', title: 'Floating lyrics', show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false },
  });
  // Above full-screen games and video too.
  bar.setAlwaysOnTop(true, 'screen-saver');
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (locked) bar.setIgnoreMouseEvents(true, { forward: true });
  bar.once('ready-to-show', () => bar.showInactive());
  const save = () => { if (alive(bar)) prefs.set('barBounds', bar.getBounds()); };
  bar.on('moved', save);
  bar.on('resized', save);
  bar.on('closed', () => { bar = null; sendTo(alive(win) ? win : null, 'mini-command', { cmd: 'closed-bar' }); updateTray(); });
  const glass = IS_MAC && glassSupported();
  if (glass) addGlass(bar, { cornerRadius: 26 });
  bar.loadURL(`app://player/mini.html?bar=1&locked=${locked ? 1 : 0}&size=${prefs.get('barSize') || 34}${glass ? '&glass=1' : ''}`);
}

function relayMini() {
  const mainWin = () => (alive(win) ? win : null);
  ipcMain.handle('mini', (event, kind, payload) => {
    if (!fromApp(event)) return false;
    if (kind === 'open-bar') { openBar(); updateTray(); return true; }
    if (kind === 'close-bar') { if (alive(bar)) bar.close(); return true; }
    if (kind === 'bar') {
      // From the bar itself: lock / unlock, text size, catch the mouse over the handle.
      if (!alive(bar) || event.sender !== bar.webContents) return false;
      const p = payload || {};
      if (typeof p.locked === 'boolean') { prefs.set('barLocked', p.locked); bar.setIgnoreMouseEvents(p.locked, { forward: true }); if (!p.locked) bar.focus(); }
      if (Number.isFinite(p.size)) prefs.set('barSize', Math.min(72, Math.max(18, Math.round(p.size))));
      if (typeof p.ignore === 'boolean' && prefs.get('barLocked') !== false) bar.setIgnoreMouseEvents(p.ignore, { forward: true });
      return true;
    }
    if (kind === 'open') {
      if (alive(mini)) { mini.show(); mini.focus(); return true; }
      mini = new BrowserWindow({
        width: 520, height: 156, minWidth: 360, minHeight: 120,
        frame: false, transparent: true, alwaysOnTop: true, resizable: true, maximizable: false, fullscreenable: false,
        backgroundColor: '#00000000', title: 'Lyric Player mini', show: false,
        icon: path.join(__dirname, 'build', 'icon.png'),
        webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), backgroundThrottling: false },
      });
      mini.setAlwaysOnTop(true, 'floating');
      mini.once('ready-to-show', () => mini.showInactive());
      mini.on('closed', () => { mini = null; sendTo(mainWin(), 'mini-command', { cmd: 'closed' }); });
      const glass = IS_MAC && glassSupported();
      if (glass) addGlass(mini, { cornerRadius: 22 });
      mini.loadURL(`app://player/mini.html${glass ? '?glass=1' : ''}`);
      return true;
    }
    if (kind === 'close') { if (alive(mini)) mini.close(); return true; }
    if (kind === 'state') { sendTo(mini, 'mini-state', payload); sendTo(bar, 'mini-state', payload); return true; }
    if (kind === 'command') { sendTo(mainWin(), 'mini-command', payload); return true; }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Tray icon and Start with Windows (Settings → App). The page sends the
// settings and what's playing; the tray menu sends commands back to it.

let prefs = null;
let tray = null;
let nowPlaying = { title: '', artist: '', playing: false, has: false };
// Windows passes --hidden from Start with Windows; macOS says it opened the app at login.
const startedHidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && (() => { try { return app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; } })());

function showMain() {
  if (quitting) return;
  if (!alive(win)) { createWindow({ show: true }); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const toPage = (cmd, value) => { if (alive(win)) sendTo(win, 'mini-command', { cmd, value }); else if (cmd === 'settings') showMain(); };

// ---------------------------------------------------------------------------
// Global shortcuts (Settings → App): work while another app is in front or
// the player is in the tray.

const HOTKEYS = [
  ['CommandOrControl+Alt+Space', 'toggle'],
  ['CommandOrControl+Alt+Right', 'next'],
  ['CommandOrControl+Alt+Left', 'prev'],
  ['CommandOrControl+Alt+L', 'bar'],
  ['CommandOrControl+Alt+P', 'window'],
];

function applyHotkeys() {
  globalShortcut.unregisterAll();
  if (!prefs?.get('hotkeys')) return [];
  const failed = [];
  for (const [keys, cmd] of HOTKEYS) {
    const ok = globalShortcut.register(keys, () => {
      if (cmd === 'window') { if (alive(win) && win.isVisible() && win.isFocused()) win.hide(); else showMain(); }
      else toPage(cmd);
    });
    if (!ok) failed.push(keys);
  }
  if (failed.length) console.log(`[hotkeys] taken by another app: ${failed.join(', ')}`);
  return failed;
}

// ---------------------------------------------------------------------------
// Phone remote (Settings → Phone remote), see remote-server.cjs.

let remote = null;

async function applyRemote() {
  remote ??= new RemoteServer({ getRoot: pageRoot, onCommand: ({ cmd, value }) => toPage(cmd, value), log: (m) => console.log(m) });
  if (!prefs.get('remote')) { remote.stop(); return; }
  if (!prefs.get('remoteToken')) prefs.set('remoteToken', RemoteServer.newToken());
  await remote.start(prefs.get('remoteToken'));
}

function updateTray() {
  if (!prefs?.get('tray')) {
    if (tray) { tray.destroy(); tray = null; }
    return;
  }
  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.on('click', () => (alive(win) && win.isVisible() && !win.isMinimized() && win.isFocused() ? win.hide() : showMain()));
  }
  const song = nowPlaying.title ? `${nowPlaying.title}${nowPlaying.artist ? ` — ${nowPlaying.artist}` : ''}` : '';
  tray.setToolTip(song ? `Lyric Player\n${song}`.slice(0, 127) : 'Lyric Player');
  tray.setContextMenu(Menu.buildFromTemplate([
    ...(song ? [{ label: song.length > 60 ? `${song.slice(0, 59)}…` : song, enabled: false }, { type: 'separator' }] : []),
    { label: nowPlaying.playing ? 'Pause' : 'Play', enabled: !!nowPlaying.has, click: () => toPage('toggle') },
    { label: 'Next', enabled: !!nowPlaying.has, click: () => toPage('next') },
    { label: 'Previous', enabled: !!nowPlaying.has, click: () => toPage('prev') },
    { type: 'separator' },
    { label: 'Floating lyrics', type: 'checkbox', checked: alive(bar), click: () => toPage('bar') },
    { label: 'Show Lyric Player', click: showMain },
    { label: 'Settings…', click: () => { showMain(); toPage('settings'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}

function applyStartup() {
  if (!app.isPackaged || process.env.LP_SELFTEST) return; // not for development copies
  const startup = !!prefs.get('startup');
  // Portable copies run from a temporary folder; point Windows at the .exe that was started.
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  if (process.platform === 'darwin') app.setLoginItemSettings({ openAtLogin: startup });
  else app.setLoginItemSettings({ openAtLogin: startup, path: exe, args: prefs.get('startHidden') !== false ? ['--hidden'] : [] });
}

function relayAppPrefs() {
  ipcMain.handle('app-prefs', (event, kind, params = {}) => {
    if (!fromApp(event)) return false;
    if (kind === 'set') {
      for (const k of ['tray', 'startup', 'startHidden', 'hotkeys', 'remote']) if (typeof params[k] === 'boolean') prefs.set(k, params[k]);
      updateTray();
      applyStartup();
      if (typeof params.hotkeys === 'boolean') applyHotkeys();
      if (typeof params.remote === 'boolean') return applyRemote().then(() => true);
      return true;
    }
    if (kind === 'hotkeys') return { list: HOTKEYS.map(([k, c]) => [k.replace('CommandOrControl', IS_MAC ? 'Cmd' : 'Ctrl'), c]), failed: prefs.get('hotkeys') ? applyHotkeys() : [] };
    if (kind === 'remote-info') return { running: !!remote?.running, urls: remote?.urls() || [] };
    if (kind === 'remote-new-code') {
      prefs.set('remoteToken', RemoteServer.newToken());
      remote?.setToken(prefs.get('remoteToken'));
      return { running: !!remote?.running, urls: remote?.urls() || [] };
    }
    if (kind === 'remote-state') { if (remote?.running) remote.setState(params); return true; }
    if (kind === 'now') {
      const next = { title: String(params.title || '').slice(0, 200), artist: String(params.artist || '').slice(0, 200), playing: !!params.playing, has: !!params.has };
      if (JSON.stringify(next) !== JSON.stringify(nowPlaying)) { nowPlaying = next; updateTray(); }
      return true;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// Music playing on this PC (Spotify, Apple Music, browsers...): the page turns
// it on and off; each change in what's playing is sent to the player window.

const APP_ID = 'local.lyricplayer.desktop';
let systemMedia = null;

function relaySystemMedia() {
  systemMedia = new SystemMedia({
    ownAppId: APP_ID,
    log: (m) => console.log(m),
    onState: (s) => sendTo(win, 'system-media', s),
  });
  ipcMain.handle('system-media', (event, kind, params = {}) => {
    if (!fromApp(event)) return false;
    if (kind === 'start') { systemMedia.start(); return process.platform === 'win32' || process.platform === 'darwin'; }
    if (kind === 'stop') { systemMedia.stop(); return true; }
    if (kind === 'command') return systemMedia.command(String(params.cmd || ''), params.value);
    return false;
  });
}

// ---------------------------------------------------------------------------
// Window buttons drawn by the page (red / yellow / green, like macOS).

function relayWindowControls() {
  ipcMain.handle('window', (event, kind) => {
    if (!fromApp(event)) return null;
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!alive(w)) return null;
    if (kind === 'close') w.close();
    else if (kind === 'minimize') w.minimize();
    else if (kind === 'zoom') { if (w.isFullScreen()) w.setFullScreen(false); else if (w.isMaximized()) w.unmaximize(); else w.maximize(); }
    else if (kind === 'fullscreen') w.setFullScreen(!w.isFullScreen());
    return { maximized: w.isMaximized(), fullscreen: w.isFullScreen(), focused: w.isFocused() };
  });
}

function reportWindowState(w) {
  const send = () => sendTo(w, 'window-state', { maximized: w.isMaximized(), fullscreen: w.isFullScreen(), focused: w.isFocused(), visible: w.isVisible() && !w.isMinimized() });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur', 'restore', 'minimize', 'show', 'hide']) w.on(ev, send);
  w.webContents.on('did-finish-load', send);
}

// ---------------------------------------------------------------------------
// Diagnostics: the page asks for the app's side of the report.

function relayDiagnostics() {
  ipcMain.handle('diagnostics', (event, text) => {
    if (!fromApp(event)) return null;
    if (typeof text === 'string') { clipboard.writeText(text.slice(0, 200000)); return true; }
    const gpu = app.getGPUFeatureStatus();
    return {
      app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
      os: `${process.platform} ${require('node:os').release()} ${process.arch}`,
      gpu: { compositing: gpu.gpu_compositing, rasterization: gpu.rasterization, webgl: gpu.webgl },
      musicFolders: folders?.folders.length ?? 0,
    };
  });
}

// Animated covers: reads an album's public Apple Music page and returns only
// the cover video links (see src/apple-art.js).
function relayAppleArt() {
  let mod = null;
  ipcMain.handle('apple-art', async (event, id, storefront) => {
    if (!event.senderFrame?.url.startsWith('app://')) throw new Error('not allowed');
    mod ??= await import(pathToFileURL(path.join(WEB_ROOT, 'src', 'apple-art.js')).href);
    const r = await fetch(mod.appleAlbumPageUrl(id, storefront), { headers: mod.RELAY_HEADERS, redirect: 'follow' });
    if (r.status === 404) return { square: null, tall: null };
    if (!r.ok) throw new Error(`Apple Music HTTP ${r.status}`);
    return mod.extractMotionArt(await r.text());
  });
}

// Apple Music Mode: a phone-shaped window. The previous size comes back when
// the mode is turned off.
function windowLayout() {
  let saved = null;
  ipcMain.handle('layout', (event, mode) => {
    if (!event.senderFrame?.url.startsWith('app://')) return;
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || w.isFullScreen()) return;
    const { screen } = require('electron');
    if (mode === 'apple') {
      if (!saved) saved = { bounds: w.getBounds(), maximized: w.isMaximized() };
      if (w.isMaximized()) w.unmaximize();
      const area = screen.getDisplayMatching(w.getBounds()).workArea;
      const height = Math.min(1000, area.height - 40);
      const width = Math.round(height * 0.462);
      w.setMinimumSize(320, 560);
      const b = w.getBounds();
      const x = Math.min(Math.max(area.x, Math.round(b.x + b.width / 2 - width / 2)), area.x + area.width - width);
      const y = Math.min(Math.max(area.y, Math.round(b.y + b.height / 2 - height / 2)), area.y + area.height - height);
      w.setBounds({ x, y, width, height }, true);
    } else if (saved) {
      w.setMinimumSize(720, 480);
      w.setBounds(saved.bounds, true);
      if (saved.maximized) w.maximize();
      saved = null;
    }
  });
}

function serveWebFiles() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const root = pageRoot();
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, {
        headers: { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

let win = null;

function createWindow({ show = true } = {}) {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: 'Lyric Player',
    backgroundColor: '#1e1e1e',
    show: false,
    // No title bar. Windows: the page draws macOS-style window buttons
    // (relayWindowControls). Mac: the real ones, placed where the page's would be.
    titleBarStyle: 'hidden',
    ...(IS_MAC ? { trafficLightPosition: { x: 20, y: 20 }, transparent: true, backgroundColor: '#00000000' } : {}),
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs'),
      spellcheck: false,
    },
  });
  // LP_SELFTEST=1: load hidden, report whether the player booted, then quit.
  if (process.env.LP_SELFTEST) {
    win.webContents.on('console-message', (e) => { if (e.level === 'error') console.log('[page error]', e.message, e.sourceId, e.lineNumber); });
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, 1500));
      const report = await win.webContents.executeJavaScript(`JSON.stringify({
        desktop: document.documentElement.classList.contains('desktop'),
        booted: !!window.lyricPlayer, idb: !!window.lyricPlayer?.library?.db,
        library: !!document.getElementById('librarySheet') })`);
      console.log('[selftest]', report);
      const gpu = app.getGPUFeatureStatus();
      console.log('[gpu]', JSON.stringify({ compositing: gpu.gpu_compositing, rasterization: gpu.rasterization }));
      const play = await win.webContents.executeJavaScript(`(async () => {
        window.lyricPlayer.demo();
        await new Promise((r) => setTimeout(r, 2500));
        document.getElementById('playBtn').click();
        await new Promise((r) => setTimeout(r, 2500));
        const p = window.lyricPlayer;
        return JSON.stringify({ t: +p.audio.currentTime.toFixed(2), playing: !p.audio.paused, bass: +p.reactor.bass.toFixed(2),
          amll: !document.querySelector('.amll-host').hidden, amllLines: document.querySelectorAll('.amll-host > div').length, amllBg: !!p.amllBg && !p.amllBg.canvas.hidden, pulse: p.amllBg?.canvas.style.transform, glass: document.documentElement.className, refract: getComputedStyle(document.getElementById('menuBtn')).backdropFilter.slice(0, 40) });
      })()`);
      console.log('[demo]', play);
      if (process.env.LP_SELFTEST_SHOTS) {
        // Apple Music Mode + animated cover, with screenshots for checking the layout.
        const shot = async (name) => {
          const img = await win.webContents.capturePage();
          await fs.writeFile(path.join(process.env.LP_SELFTEST_SHOTS, name), img.toPNG());
        };
        await shot('standard.png');
        const auto = await win.webContents.executeJavaScript(`(async () => {
          const p = window.lyricPlayer;
          const blob = await (await fetch(p.audio.src)).blob();
          const dt = new DataTransfer();
          dt.items.add(new File([blob], 'Tame Impala - New Person, Same Old Mistakes.wav', { type: 'audio/wav' }));
          window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          for (let i = 0; i < 40 && !document.getElementById('art').classList.contains('motion-on'); i++) await new Promise((r) => setTimeout(r, 250));
          const dlg = document.getElementById('artSearch');
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }));
          for (let i = 0; i < 40 && !/animated/.test(dlg.querySelector('.ls-status').textContent); i++) await new Promise((r) => setTimeout(r, 250));
          const out = { cover: p.cover && p.cover.album, square: !!(p.cover && p.cover.square), useArt: p.cover && p.cover.useArt, motionOn: document.getElementById('art').classList.contains('motion-on'),
            art: document.getElementById('artImg').src.slice(0, 40), search: dlg.querySelector('input').value, status: dlg.querySelector('.ls-status').textContent,
            rows: [...dlg.querySelectorAll('.ls-row')].slice(0, 4).map((r) => r.querySelector('.ls-title').textContent + ' [' + r.querySelector('.ls-badge').textContent + ']') };
          dlg.querySelector('[data-close]').click();
          const saved = await p.library.get((await p.library.list())[0].id);
          out.saved = saved && saved.cover && saved.cover.album;
          return JSON.stringify(out);
        })()`);
        console.log('[auto-cover]', auto);
        const art = await win.webContents.executeJavaScript(`(async () => {
          const m = await import('./src/apple-art.js');
          const album = await m.findAlbum({ title: 'New Person, Same Old Mistakes', artist: 'Tame Impala' });
          const motion = album ? await m.fetchMotionArt(album.collectionId, album.storefront) : null;
          const p = window.lyricPlayer;
          p.settings.set('layout', 'apple');
          await new Promise((r) => setTimeout(r, 800));
          if (motion?.square) await p.motion.play(motion.square);
          await new Promise((r) => setTimeout(r, 5000));
          return JSON.stringify({ album: album && album.album + ' #' + album.collectionId, motion, motionOn: document.getElementById('art').classList.contains('motion-on'),
            videoTime: +p.motion.video.currentTime.toFixed(2), videoW: p.motion.video.videoWidth, controls: document.getElementById('app').classList.contains('show-controls'),
            metrics: (() => { const r = (el) => el && el.getBoundingClientRect(); const h = r(document.querySelector('.amll-host')); const lines = [...document.querySelectorAll('.amll-host .FmKaba_lyricLine')]; const act = lines.find((l) => l.classList.contains('FmKaba_active')) || null; const a = r(act); const span = act && r(act.querySelector('span')); const art = r(document.getElementById('art'));
              return { host: [h.left, h.top, h.width, h.height].map(Math.round), active: a && [a.left, a.top, a.height].map(Math.round), text: span && [span.left, span.top].map(Math.round), art: [art.left, art.top, art.width].map(Math.round), pad: act && getComputedStyle(act).paddingLeft, fs: getComputedStyle(document.querySelector('.amll-host')).fontSize, cfg: JSON.stringify(p.renderer.player.layoutConfig || p.renderer.player.layout?.layoutConfig || null) }; })() });
        })()`);
        console.log('[art]', art);
        await win.webContents.executeJavaScript(`window.lyricPlayer.audio.pause(); document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); window.dispatchEvent(new PointerEvent('pointermove')); new Promise((r) => setTimeout(r, 900))`);
        await shot('apple-controls.png');
        await win.webContents.executeJavaScript(`window.lyricPlayer.audio.play()`);
        await win.webContents.executeJavaScript(`document.getElementById('app').classList.remove('show-controls'); new Promise((r) => setTimeout(r, 1200))`);
        await shot('apple.png');
        console.log('[bounds]', JSON.stringify(win.getBounds()));
        await win.webContents.executeJavaScript(`document.getElementById('fullscreenBtn').click()`, true);
        await new Promise((r) => setTimeout(r, 1500));
        const fs1 = await win.webContents.executeJavaScript(`JSON.stringify({ doc: !!document.fullscreenElement, pressed: document.getElementById('fullscreenBtn').getAttribute('aria-pressed') })`);
        console.log('[fullscreen]', fs1, 'window', win.isFullScreen());
        await shot('apple-fullscreen.png');
        await win.webContents.executeJavaScript(`document.exitFullscreen()`, true);
        await new Promise((r) => setTimeout(r, 1200));
        console.log('[fullscreen-exit]', win.isFullScreen());
        await win.webContents.executeJavaScript(`window.lyricPlayer.settings.set('layout', 'standard')`);
        await new Promise((r) => setTimeout(r, 1000));
        console.log('[bounds-restored]', JSON.stringify(win.getBounds()));
        await shot('standard-after.png');
        const panel = await win.webContents.executeJavaScript(`(async () => {
          window.lyricPlayer.settings.set('discord', true);
          document.getElementById('settingsBtn').click();
          await new Promise((r) => setTimeout(r, 1500));
          const sec = [...document.querySelectorAll('.sheet-section')].find((h) => h.textContent === 'Apple Music');
          sec?.scrollIntoView();
          await new Promise((r) => setTimeout(r, 400));
          window.lyricPlayer.settings.set('discordAppId', '123456789012345678');
          await new Promise((r) => setTimeout(r, 3500));
          const am = await window.lyricPlayerNative.appleMusic('status').catch((e) => e.message);
          const amLyrics = await import('./src/apple-music.js').then((m) => m.fetchAppleTtml('1468058171')).catch((e) => 'error: ' + e.message);
          window.lyricPlayer.settings.set('discordAppId', '');
          return JSON.stringify({ am, amLyrics, sections: [...document.querySelectorAll('.sheet-section')].map((h) => h.textContent), texts: document.querySelectorAll('.set-text').length,
            acct: document.querySelector('.acct-state')?.textContent, discordStatus: document.querySelector('.discord-status')?.textContent });
        })()`);
        console.log('[settings]', panel);
        await shot('settings.png');
      }
      const search = await win.webContents.executeJavaScript(`import('./src/lyrics-search.js').then(async (m) => {
        const { results: all } = await m.searchLyrics('cruel summer taylor swift');
        const ne = all.filter((r) => r.source === 'netease');
        const neTtml = ne[0] ? await m.getTtml(ne[0]) : '';
        const qq = all.filter((r) => r.source === 'qq');
        const qqTtml = qq[0] ? await m.getTtml(qq[0]) : '';
        console.error('[qq]', qq.length, qq[0] && qq[0].title + ' / ' + qq[0].artists.join(','), 'wordSync', qq[0] && qq[0].wordSync, 'spans', (qqTtml.match(/<span begin/g) || []).length, 'trans', (qqTtml.match(/x-translation/g) || []).length);
        console.error('[netease]', ne.length, ne[0] && ne[0].title, 'wordSync', ne[0] && ne[0].wordSync, 'ttml', neTtml.length, (neTtml.match(/<span begin/g) || []).length, 'word spans');
        const { results, errors } = await m.searchLyrics('idol yoasobi');
        const ttml = results[0] ? await m.getTtml(results[0]) : '';
        return JSON.stringify({ n: results.length, first: results[0] && results[0].source + ':' + results[0].title, ttmlBytes: ttml.length, errors });
      })`);
      console.log('[search]', search);
      // Extra checks from a script outside the app (development only).
      if (process.env.LP_SELFTEST_SCRIPT) {
        try {
          const run = require(process.env.LP_SELFTEST_SCRIPT);
          const shot = async (name, w = win) => fs.writeFile(path.join(process.env.LP_SELFTEST_SHOTS || require('node:os').tmpdir(), name), (await w.webContents.capturePage()).toPNG());
          await run({ win, app, shot, BrowserWindow, folders });
        } catch (e) { console.log('[script error]', e.stack); }
      }
      app.quit();
    });
  } else if (show) {
    win.once('ready-to-show', () => win.show());
  }
  // Links open in the normal browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  reportWindowState(win);
  watchUpdatedPage(win);
  if (IS_MAC && glassSupported()) addGlass(win);
  win.loadURL('app://player/index.html');
  // With the tray icon on, closing only hides the window (it keeps following
  // your music). Otherwise closing the player closes everything: the mini
  // player and the hidden Apple Music window would keep the app running.
  win.on('close', (e) => {
    if (!quitting && prefs?.get('tray')) { e.preventDefault(); if (IS_MAC && win.isFullScreen()) { win.once('leave-full-screen', () => win.hide()); win.setFullScreen(false); } else win.hide(); }
  });
  win.on('closed', () => {
    win = null;
    quitting = true;
    if (alive(mini)) mini.destroy();
    if (alive(bar)) bar.destroy();
    if (alive(amWin)) amWin.destroy();
    tray?.destroy();
    systemMedia?.stop();
    app.quit();
  });
}

// Self-test runs get a throwaway profile so they never touch (or collide with)
// a copy of the app that is already open.
// Development copies can run beside the installed app with their own profile.
if (process.env.LP_USERDATA) app.setPath('userData', process.env.LP_USERDATA);
if (process.env.LP_SELFTEST && !process.env.LP_USERDATA) {
  app.setPath('userData', path.join(require('node:os').tmpdir(), `lyric-player-selftest-${process.pid}`));
}

if (!process.env.LP_SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Opening the app again brings this copy forward, or opens a fresh window
  // if this one's player window is gone.
  app.on('second-instance', () => showMain());
  app.setAppUserModelId(APP_ID);
  app.whenReady().then(() => {
    // Mac apps need the app menu (Cmd+Q, Cmd+C / V, Cmd+W…); Windows has none.
    Menu.setApplicationMenu(IS_MAC ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    prefs = new DesktopPrefs(path.join(app.getPath('userData'), 'desktop-prefs.json'));
    webUpdate = new WebUpdate({ bundledRoot: WEB_ROOT, dataDir: app.getPath('userData'), appVersion: app.getVersion(), log: (m) => console.log(m) });
    if (webUpdate.usingUpdate) console.log(`[web-update] using ${webUpdate.version()}`);
    serveWebFiles();
    relayNetease();
    relayAppleArt();
    relayQQMusic();
    relayAppleMusic();
    relayDiscord();
    relayMusicFolders();
    relayLastFm();
    relayUpdates();
    relayMini();
    relayDiagnostics();
    relaySystemMedia();
    relayWindowControls();
    relayAppPrefs();
    relayGlass();
    windowLayout();
    updateTray();
    applyHotkeys();
    applyRemote().catch(() => {});
    // Started with Windows "in the tray": no window until the tray icon is clicked.
    createWindow({ show: !(startedHidden && prefs.get('tray')) });
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { globalShortcut.unregisterAll(); remote?.stop(); });
  // Mac: clicking the Dock icon brings the window back (from the tray too).
  app.on('activate', () => { if (app.isReady()) showMain(); });
}
