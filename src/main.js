import { parseTTML } from './ttml-parser.js';
import { PlaybackClock } from './clock.js';
import { AmllLyricsRenderer } from './amll-renderer.js';
import { PlayerUI } from './player-ui.js';
import { ArtworkBackground } from './background.js';
import { AmllBackground } from './amll-background.js';
import { LyricifyBackground } from './lyricify-background.js';
import { AudioReactor } from './audio-reactor.js';
import { Settings } from './settings.js';
import { SettingsPanel } from './settings-panel.js';
import { glass, glassAll, setGlassEnabled } from './liquid-glass.js';
import { LyricsSearchDialog } from './lyrics-search-ui.js';
import { Library, songId, makeThumb } from './library.js';
import { MotionArtwork } from './motion-art.js';
import { ArtSearchDialog } from './art-search-ui.js';
import { findAlbum, fetchMotionArt, artworkAt } from './apple-art.js';
import { appleMusicAvailable, appleMusicStatus, appleMusicSignIn, appleMusicSignOut, knownSignedIn } from './apple-music.js';
import { SOURCE_NAMES, searchLyrics, getTtml } from './lyrics-search.js';
import { Queue } from './queue.js';
import { LibraryPanel } from './library-ui.js';
import { bindWindowControls } from './window-controls.js';
import { SystemPlayback, normalizeTrack } from './system-media.js';
import { pickBestLyrics } from './auto-lyrics.js';
import { diagnostics } from './diagnostics.js';
import { buildAboutRow, buildLastfmRow, updateSite, UPDATE_SITE } from './about-ui.js';
import { Scrobbler } from './scrobbler.js';
import { SyncEditor } from './sync-editor.js';
import { LyricCardDialog } from './lyric-card.js';
import { romanizeLocally, mergeRomanization, lookupRomanization, clearAddedRomanization } from './romanize.js';
import { searchNetease, fetchNeteaseLyrics } from './netease.js';
import { searchQQ, fetchQQLyrics, qrcLines } from './qq-music.js';
import { lyricsMatch } from './auto-lyrics.js';
import { showWhatsNew } from './whats-new.js';
import { readCredit, isExpired, mayExport } from './spicy-lyrics.js';

const JSMEDIATAGS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js';
const AUDIO_EXT = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav'];
const TTML_EXT = ['ttml', 'xml'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'];

const $ = (id) => document.getElementById(id);
if (navigator.userAgent.includes(' Electron/')) document.documentElement.classList.add('desktop');
if (window.lyricPlayerNative?.platform === 'darwin') document.documentElement.classList.add('mac');
const audio = $('audio');
const app = $('app');
const native = window.lyricPlayerNative || null;

const state = {
  audioName: null,
  ttmlName: null,
  model: null,
  audioUrl: null,
  artUrl: null,
  tagMeta: {},
  ttmlMeta: {},
  fileMeta: {},
  loadToken: 0,
  prefsKey: null,
  showTranslation: false,
  lyricsHidden: false,
  songId: null,        // library id of the current song (null for demo / URL audio)
  lyricsFor: null,     // song id the shown lyrics belong to
  pendingTtml: null,   // lyrics loaded before any song, attached when one arrives
  cover: null,         // Apple Music album for this song: { collectionId, album, artwork, square, tall, off, useArt }
  coverFor: null,      // song the automatic cover lookup ran for
  external: null,      // following another app on this PC: { key, app }
};

const library = new Library();
let rememberChain = Promise.resolve();

// ---------------------------------------------------------------------------
// Toasts

function toast(message, { error = false, key = null, ms = 2600 } = {}) {
  const host = $('toasts');
  let el = key ? host.querySelector(`[data-key="${key}"]`) : null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    if (key) el.dataset.key = key;
    host.appendChild(el);
    glass(el);
    requestAnimationFrame(() => el.classList.add('in'));
  }
  el.classList.toggle('error', error);
  el.textContent = message;
  if (error) diagnostics.note(`error shown: ${message}`);
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, error ? Math.max(ms, 6000) : ms);
}

// ---------------------------------------------------------------------------
// Persistence (offset + volume per song)

function loadPrefs() {
  if (!state.audioName || !Number.isFinite(audio.duration)) return;
  state.prefsKey = `lyricplayer:${state.audioName}:${Math.round(audio.duration)}`;
  let prefs = null;
  try { prefs = JSON.parse(localStorage.getItem(state.prefsKey) || 'null'); } catch { /* storage unavailable */ }
  setOffset(Number.isFinite(prefs?.offset) ? prefs.offset : 0, false);
  if (Number.isFinite(prefs?.volume)) audio.volume = Math.min(1, Math.max(0, prefs.volume));
}

function savePrefs() {
  if (!state.prefsKey) return;
  try {
    localStorage.setItem(state.prefsKey, JSON.stringify({ offset: clock.offsetMs, volume: audio.volume }));
    // Apps on this PC tend to be early or late by the same amount, so the
    // latest offset also becomes that app's default for songs without their own.
    if (state.external) localStorage.setItem(pcAppOffsetKey(state.external.app), String(clock.offsetMs));
  } catch { /* storage unavailable */ }
}

const pcAppOffsetKey = (name) => `lyricplayer:pcApp:${name}`;

// ---------------------------------------------------------------------------
// Core objects

const clock = new PlaybackClock(audio);
const settings = new Settings();
const reactor = new AudioReactor(audio);
const queue = new Queue();

// Backgrounds: AMLL's WebGL mesh gradient, or our blurred artwork (also the
// fallback when WebGL isn't available).
const artworkBg = new ArtworkBackground($('bg'));
let amllBg = null;
try { amllBg = new AmllBackground($('bg')); } catch { /* no WebGL */ }
let lyricifyBg = null;
try { lyricifyBg = new LyricifyBackground($('bg')); } catch (e) { diagnostics.error('lyricify background', e); }
let background = artworkBg;
const background_ = {
  setImage(url) { artworkBg.setImage(url); amllBg?.setImage(url); lyricifyBg?.setImage(url); },
};

function seek(t) {
  if (state.external) {
    if (!pcState.raw?.canSeek) { toast(`${state.external.app} doesn't let other apps change its position`, { key: 'pcseek' }); return; }
    const d = sys.duration;
    pcCommand('seek', Math.max(0, Number.isFinite(d) ? Math.min(t, d - 0.5) : t));
    return;
  }
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(Math.max(0, t), Math.max(0, audio.duration - 0.05));
}

function togglePlay() {
  if (state.external) { pcCommand('toggle'); return; }
  if (!audio.src) return;
  if (audio.paused) audio.play().catch((e) => toast(`Can't play: ${e.message}`, { error: true }));
  else audio.pause();
}

/** What's playing, wherever it plays (this app or another app on the PC). */
function playback() {
  if (state.external) return { has: true, playing: sys.playing, position: sys.position(), duration: sys.duration, rate: sys.rate };
  return { has: !!audio.src, playing: !audio.paused && !audio.ended, position: audio.currentTime, duration: audio.duration, rate: audio.playbackRate || 1 };
}

function setOffset(ms, announce = true) {
  clock.offsetMs = Math.round(ms);
  ui.setOffsetLabel(clock.offsetMs);
  if (announce) {
    toast(`Lyric offset ${clock.offsetMs > 0 ? '+' : ''}${clock.offsetMs} ms`, { key: 'offset', ms: 1400 });
    savePrefs();
  }
}

const ui = new PlayerUI(audio, {
  onSeek: seek,
  onTogglePlay: togglePlay,
  onToggleLyrics: toggleLyrics,
  onPrev: () => playPrev(),
  onNext: () => playNext(),
  onNotice: (msg) => toast(msg),
  onMenuAction(action) {
    switch (action) {
      case 'load-audio': $('audioInput').click(); break;
      case 'load-ttml': $('ttmlInput').click(); break;
      case 'offset-minus': setOffset(clock.offsetMs - 50); break;
      case 'offset-plus': setOffset(clock.offsetMs + 50); break;
      case 'offset-reset': setOffset(0); break;
      case 'translation': toggleTranslation(); break;
      case 'settings': settingsPanel.open(); break;
      case 'demo': loadDemo(); break;
      case 'find-lyrics': openLyricSearch(); break;
      case 'find-art': openArtSearch(); break;
      case 'remove-motion': setCover(state.cover && { ...state.cover, off: true }, { save: true }); toast('Using the still cover for this song'); break;
      case 'am-mode': settings.set('layout', settings.get('layout') === 'apple' ? 'standard' : 'apple'); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'sync-editor': syncEditor.open(); break;
      case 'lyric-card': lyricCard.open(); break;
      case 'mini': toggleMini(); break;
      case 'bar': toggleBar(); break;
      case 'whats-new': showWhatsNew({ force: true }); break;
    }
  },
});

const renderer = new AmllLyricsRenderer($('lyrics'), {
  onSeek(t) {
    seek(t - clock.offsetMs / 1000);
    if (!playback().playing) togglePlay();
  },
});
renderer.setLyrics(null, document.documentElement.classList.contains('ios')
  ? 'Play a song in the Music app, or add your own songs and lyrics with ••• → Load new song'
  : 'Play a song in Spotify or Apple Music, drop a song and its .ttml here, or open your library with ☰');

// ---------------------------------------------------------------------------
// Settings (lyrics, background, Liquid Glass)

const settingsPanel = new SettingsPanel($('settingsSheet'), settings, {
  onClose: () => $('settingsBtn').setAttribute('aria-expanded', 'false'),
  custom: {
    appleAccount: buildAppleAccountRow,
    discordStatus: (row) => { discordStatusRow = row; row.hidden = true; },
    lastfmAccount: (row) => buildLastfmRow(row, { settings, toast }),
    about: (row) => buildAboutRow(row, { settings, toast }),
  },
});
$('settingsBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.toggle();
  $('settingsBtn').setAttribute('aria-expanded', String(settingsPanel.isOpen));
});
document.addEventListener('pointerdown', (e) => {
  if (settingsPanel.isOpen && !e.target.closest('#settingsSheet, #settingsBtn, .menu')) settingsPanel.close();
});

settings.subscribe((key, value, s) => {
  const am = s.layout === 'apple';
  // Apple Music Mode keeps the current line near the top, under the header.
  renderer.apply(am ? { ...s, alignAnchor: 'top', alignPosition: Math.min(s.alignPosition, 0.35) * 0.3 } : s);
  if (key === null || key === 'layout') applyLayout(am);
  if (key === 'motionArt') applyCover();
  if (key === null || key.startsWith('discord')) updatePresence();
  if (key === 'autoArt' && value) autoCover();
  if (key === 'followPc' && pcState?.available) startSystemMedia(s.followPc);
  if (key === null || key === 'tray' || key === 'startup' || key === 'startHidden') native?.appPrefs?.('set', { tray: s.tray, startup: s.startup, startHidden: s.startHidden }).catch(() => {});
  if (key === 'autoRoman' && state.model) {
    if (value) { romanizeLocally(state.model); borrowRomanization(state.model); } else clearAddedRomanization(state.model);
    renderer.setLyrics(state.model, '');
  }
  state.showTranslation = s.translation;
  ui.setTranslation(!!state.model?.hasTranslation, s.translation);

  const useLyricify = s.bgStyle === 'lyricify' && !!lyricifyBg;
  const useAmll = !useLyricify && s.bgStyle !== 'artwork' && !!amllBg;
  background = useLyricify ? lyricifyBg : useAmll ? amllBg : artworkBg;
  lyricifyBg?.setActive(useLyricify);
  amllBg?.setActive(useAmll);
  artworkBg.setActive(!useAmll && !useLyricify);
  lyricifyBg?.apply(s);
  amllBg?.apply(s);
  artworkBg.apply(s);
  $('bg').style.setProperty('--dim', s.bgDim);
  $('bg').classList.toggle('amll-mode', useAmll);
  $('bg').classList.toggle('lyricify-mode', useLyricify);
  reactor.enabled = s.bgReact > 0 || s.bgPulse > 0;
  if (reactor.enabled && !audio.paused) reactor.attach();

  setGlassEnabled(s.glass);
  if (key === null || key === 'macGlass') applyGlassWindow();
});

// Mac (macOS 26): the window itself can be real Liquid Glass, showing the
// desktop through it, instead of the cover background (Settings → Background).
var glassWindowOk = false; // var: the settings subscription above runs first
function applyGlassWindow() {
  // Strictly true/false: an undefined second argument would make toggle() flip the class.
  const on = !!(glassWindowOk && settings?.get('macGlass'));
  document.documentElement.classList.toggle('glass-window', on);
}
native?.glass?.('supported').then((ok) => { glassWindowOk = !!ok; applyGlassWindow(); }).catch(() => {});
glassAll('.round, .ibtn, .menu, .sheet, .qtoggle, .stepper button, .seg, .sheet-btn, .ls-panel');

// ---------------------------------------------------------------------------
// Apple Music Mode: a phone-shaped portrait player like the iPhone lyrics view.
// Controls slide up when the pointer moves and hide again when idle.

function applyLayout(am) {
  const wasAm = document.documentElement.classList.contains('am-mode');
  document.documentElement.classList.toggle('am-mode', am);
  $('amModeItem').setAttribute('aria-checked', String(am));
  if (am !== wasAm) {
    window.lyricPlayerNative?.setLayout?.(am ? 'apple' : 'standard').catch(() => {});
    if (am) showControls(); else app.classList.remove('show-controls');
    applyNowPlaying();
    renderer.remeasure();
    setTimeout(() => renderer.remeasure(), 450); // after the window has resized
  }
}

var controlsTimer = 0; // var: the settings subscription can call showControls before this line runs
function showControls() {
  if (!document.documentElement.classList.contains('am-mode')) return;
  app.classList.add('show-controls');
  clearTimeout(controlsTimer);
  controlsTimer = setTimeout(function hide() {
    const busy = $('controls').matches(':hover') || document.querySelector('.menu:not([hidden])') || document.querySelector('.dragging') || audio.paused;
    if (busy) controlsTimer = setTimeout(hide, 1000);
    else app.classList.remove('show-controls');
  }, 3000);
}
addEventListener('pointermove', showControls, { passive: true });
addEventListener('pointerdown', showControls, { passive: true });

// ---------------------------------------------------------------------------
// Full screen (F, F11, the button or the menu). The cursor hides when idle.

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch((e) => toast(`Can't go full screen: ${e.message}`, { error: true }));
}
let idleTimer = 0;
function markActive() {
  document.documentElement.classList.remove('idle');
  clearTimeout(idleTimer);
  if (document.fullscreenElement) idleTimer = setTimeout(() => document.documentElement.classList.add('idle'), 2500);
}
addEventListener('pointermove', markActive, { passive: true });
function syncFullscreen() {
  const on = !!document.fullscreenElement;
  if ($('fullscreenBtn').getAttribute('aria-pressed') === String(on)) return;
  $('fullscreenBtn').setAttribute('aria-pressed', String(on));
  $('fullscreenBtn').setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
  $('fullscreenItem').setAttribute('aria-checked', String(on));
  markActive();
  renderer.remeasure();
}
document.addEventListener('fullscreenchange', syncFullscreen);
addEventListener('resize', syncFullscreen);
$('fullscreenBtn').addEventListener('click', toggleFullscreen);

// ---------------------------------------------------------------------------
// Album covers from Apple Music, including animated covers

const motion = new MotionArtwork($('art'));
var tallMotion = new MotionArtwork($('nowBg')); // var: applyNowPlaying can run (from settings) before this line

// Apple Music Mode with the lyrics hidden is the iPhone's Now Playing screen:
// big cover (or the tall animated cover, full-bleed), title, controls.
function applyNowPlaying() {
  const np = document.documentElement.classList.contains('am-mode') && state.lyricsHidden;
  document.documentElement.classList.toggle('now-playing', np);
  const c = state.cover;
  const tall = np && settings.get('motionArt') && c && !c.off && c.tall ? c.tall : null;
  tallMotion?.play(tall).catch(() => {});
  if (np) showControls();
}

/** Shows a cover for the current song (or none) and remembers it. */
function setCover(cover, { save = false } = {}) {
  state.cover = cover?.collectionId ? cover : null;
  if (state.cover?.useArt && state.cover.artwork && state.artUrl !== state.cover.artwork) setArtwork(state.cover.artwork, { owned: false, save: false });
  applyCover();
  if (save) remember({ cover: state.cover });
}

function applyCover() {
  updatePresence();
  applyNowPlaying();
  const c = state.cover;
  const url = settings.get('motionArt') && c && !c.off ? c.square : null;
  motion.play(url).catch((e) => toast(`Can't play the animated cover: ${e.message}`, { error: true }));
  $('removeMotionItem').hidden = !(c?.square && !c.off);
}

function songInfo() {
  const own = (k) => state.tagMeta[k] || (state.lyricsFor === state.songId ? state.ttmlMeta[k] : null) || state.fileMeta[k] || '';
  return { title: own('title'), artist: own('artist'), album: state.tagMeta.album || '' };
}

/** Looks the song up on Apple Music once: animated cover, and the cover if the file has none. */
async function autoCover() {
  const id = state.songId;
  if (!id || !settings.get('autoArt') || state.coverFor === id || state.cover) return;
  const info = songInfo();
  if (!info.title || !info.artist) return; // too little to match reliably
  state.coverFor = id;
  try {
    const album = await findAlbum(info);
    if (id !== state.songId) return;
    if (!album) { remember({ cover: { none: true } }, { id }); return; }
    let m = { square: null, tall: null };
    try { m = await fetchMotionArt(album.collectionId, album.storefront); } catch { /* still cover only */ }
    if (id !== state.songId) return;
    const cover = { collectionId: album.collectionId, album: album.album, artwork: album.artwork, square: m.square, tall: m.tall, useArt: !state.artUrl };
    setCover(cover, { save: true });
    if (cover.square && settings.get('motionArt')) toast(`Animated cover found: ${album.album}`);
  } catch {
    state.coverFor = null; // offline: try again next time
  }
}

const artSearch = new ArtSearchDialog($('artSearch'), {
  onPick(r) {
    const cover = { collectionId: r.collectionId, album: r.album, artwork: r.artwork, square: r.motion?.square || null, tall: r.motion?.tall || null, useArt: true };
    setCover(cover, { save: true });
    toast(cover.square
      ? `Animated cover from ${r.album}${settings.get('motionArt') ? '' : ' (turn on Animated covers in Settings to see it move)'}`
      : `${r.album} has no animated cover, so its still cover is used`);
  },
});

function openArtSearch(query) {
  if (typeof query === 'string' && query) { artSearch.open(query); return; }
  // This song's own title/artist (not those of lyrics left over from another song).
  const info = state.songId ? songInfo() : null;
  const pick = (k) => info?.[k] || state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || '';
  artSearch.open([pick('title'), pick('artist')].filter(Boolean).join(' '));
}

// ---------------------------------------------------------------------------
// Apple Music account (desktop app): sign in on Apple's own page in an app
// window; lyrics then come from your subscription.

function buildAppleAccountRow(row) {
  row.classList.add('acct');
  row.innerHTML = `
    <div class="set-head">
      <span class="set-label">Account</span>
      <span class="acct-state" role="status">Not signed in</span>
    </div>
    <div class="acct-buttons">
      <button type="button" class="pill acct-signin">Sign in to Apple Music…</button>
      <button type="button" class="pill acct-signout" hidden>Sign out</button>
    </div>
    <div class="set-hint">Opens music.apple.com in a window: sign in there with your Apple Account, then close it. Needs an Apple Music subscription; the app never sees your password. This uses Apple's web player in a way Apple doesn't officially support, so use it at your own risk.</div>`;
  const stateEl = row.querySelector('.acct-state');
  const signIn = row.querySelector('.acct-signin');
  const signOut = row.querySelector('.acct-signout');
  const show = (s, note) => {
    stateEl.textContent = note || (s.signedIn ? `Signed in (${String(s.storefront || 'us').toUpperCase()} store)` : 'Not signed in');
    signIn.hidden = !!s.signedIn;
    signOut.hidden = !s.signedIn;
  };
  show({ signedIn: knownSignedIn() });
  let poll = 0;
  signIn.addEventListener('click', async () => {
    try {
      show({ signedIn: false }, 'Waiting for you to sign in…');
      await appleMusicSignIn();
      clearInterval(poll);
      let tries = 0;
      poll = setInterval(async () => {
        const s = await appleMusicStatus({ refresh: true }).catch(() => ({ signedIn: false }));
        if (s.signedIn || ++tries > 150) {
          clearInterval(poll);
          show(s, s.signedIn ? null : 'Not signed in');
          if (s.signedIn) toast('Signed in to Apple Music. Its lyrics now show first in Find lyrics');
        }
      }, 2000);
    } catch (e) {
      show({ signedIn: false }, `Couldn't open Apple Music: ${e.message}`);
    }
  });
  signOut.addEventListener('click', async () => {
    clearInterval(poll);
    await appleMusicSignOut().catch(() => {});
    show({ signedIn: false });
    toast('Signed out of Apple Music');
  });
  // Confirm a remembered sign-in still works (loads the web player in the background).
  if (knownSignedIn()) appleMusicStatus({ refresh: true }).then((s) => show(s)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Discord Rich Presence (desktop app): song, artist, length and the cover.

var discordStatusRow; // var (no initializer): the settings panel sets it before this line runs
var presenceTimer;

function fillTemplate(tpl, info) {
  return String(tpl || '').replace(/\{(title|artist|album)\}/g, (_, k) => info[k] || '').replace(/\s+([·\-|–—])\s*$/, '').trim();
}

function updatePresence() {
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(sendPresence, 300);
}

async function sendPresence() {
  sendTray();
  const send = window.lyricPlayerNative?.discord;
  if (!send) return;
  const s = settings.values;
  const appId = (s.discordAppId || '').trim();
  const showRow = (text, error = false) => {
    if (!discordStatusRow) return;
    discordStatusRow.hidden = !text;
    discordStatusRow.className = `set-row set-custom discord-status${error ? ' error' : ''}`;
    discordStatusRow.textContent = text || '';
  };
  if (!s.discord) { send(null).catch(() => {}); showRow(''); return; }
  if (!/^\d{15,22}$/.test(appId)) { send(null).catch(() => {}); showRow('Add your Discord Application ID below to start.', true); return; }

  const pick = (k) => state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || '';
  const info = { title: pick('title'), artist: pick('artist'), album: state.tagMeta.album || state.cover?.album || '' };
  const pb = playback();
  const hasSong = pb.has && !!info.title;
  const playing = pb.playing;
  let activity = null, animated = null;
  if (hasSong && (playing || s.discordPaused)) {
    activity = {
      details: fillTemplate(s.discordDetails || '{title}', info),
      state: fillTemplate(s.discordState, info) || (playing ? '' : 'Paused'),
      imageText: fillTemplate(s.discordImageText, info),
    };
    if (!playing && s.discordPaused && activity.state) activity.state = `${activity.state} · Paused`;
    if (playing && s.discordTime && Number.isFinite(pb.duration)) {
      const start = Date.now() - pb.position * 1000 / pb.rate;
      activity.start = start;
      activity.end = start + pb.duration * 1000 / pb.rate;
    }
    const c = state.cover;
    if (s.discordCover !== 'none' && c?.artwork) activity.image = artworkAt(c.artwork, 512);
    const site = (s.discordSite || s.site || UPDATE_SITE).trim().replace(/\/+$/, '');
    if (s.discordCover === 'animated' && c?.square && !c.off && /^https:\/\/[^\s/]+/.test(site)) {
      animated = `${site}/api/cover-gif?id=${c.collectionId}&sf=us`;
    }
  }
  try {
    const status = await send({ clientId: appId, activity, animated });
    showRow({
      connected: activity ? 'Connected: showing on your Discord profile.' : 'Connected: nothing playing.',
      connecting: 'Connecting to Discord…',
      'no-discord': 'Discord isn\u2019t running. It will connect when you open it.',
    }[status] || (status?.startsWith('error') ? `Discord said: ${status.slice(7)}. Check the Application ID.` : ''), status?.startsWith('error'));
    if (status === 'connecting') setTimeout(updatePresence, 2500);
  } catch (e) {
    showRow(`Couldn't update Discord (${e.message}).`, true);
  }
}

for (const ev of ['play', 'pause', 'seeked', 'loadedmetadata', 'ended', 'ratechange']) audio.addEventListener(ev, updatePresence);

// Tray icon (desktop app): the song in its tooltip and menu.
function sendTray() {
  const n = window.lyricPlayerNative;
  if (!n?.appPrefs) return;
  const pick = (k) => state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || '';
  const pb = playback();
  n.appPrefs('now', { title: pick('title'), artist: pick('artist'), playing: pb.has && pb.playing, has: pb.has, bar: barOpen }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Last.fm (desktop app): now playing + scrobbles (rules in scrobbler.js).

const scrobbler = new Scrobbler((kind, track) => {
  const lf = window.lyricPlayerNative?.lastfm;
  if (!lf || !settings.get('lastfm')) return Promise.resolve(false);
  return lf(kind, { track, apiKey: settings.get('lastfmKey').trim(), secret: settings.get('lastfmSecret').trim() })
    .then((ok) => { if (ok && kind === 'scrobble') diagnostics.note(`scrobbled "${track.title}"`); return ok; })
    .catch((e) => { diagnostics.error(`last.fm ${kind}`, e); throw e; });
});
let scrobbleKey = null;
audio.addEventListener('playing', () => {
  const key = `${state.loadToken}`;
  if (key === scrobbleKey || !settings.get('lastfm')) return;
  scrobbleKey = key;
  const pick = (k) => state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || '';
  scrobbler.start({ title: pick('title'), artist: pick('artist'), album: state.tagMeta.album || state.cover?.album || '', duration: Number.isFinite(audio.duration) ? audio.duration : 0 });
});
setInterval(() => scrobbler.tick(audio.currentTime, !audio.paused && !audio.ended), 1000);

// ---------------------------------------------------------------------------
// Sync editor and lyric cards

const syncEditor = new SyncEditor($('syncEditor'), {
  getTtml: () => ({ text: state.ttmlText, name: state.ttmlName, model: state.model }),
  canExport: () => mayExport(state.lyricsCredit),
  time: () => clock.lyricTime,
  togglePlay,
  seek: (t) => seek(t - clock.offsetMs / 1000),
  preview: (text) => loadTTMLText(text, state.ttmlName || 'lyrics.ttml', { save: false }),
  save: (text) => {
    loadTTMLText(text, state.ttmlName || 'lyrics.ttml', { save: !!state.songId || !!state.external });
    diagnostics.note('timing edited and saved');
  },
  toast,
});

const lyricCard = new LyricCardDialog($('cardDialog'), {
  get: () => {
    const pick = (k) => state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || '';
    return { model: state.model, title: pick('title'), artist: pick('artist'), art: state.artUrl, time: clock.lyricTime, motionBg: () => lyricifyBg?.snapshot() || null, credit: creditText(state.lyricsCredit) };
  },
  toast,
});

// ---------------------------------------------------------------------------
// Mini player (desktop app): a small always-on-top window with the line
// being sung. This window sends it the state a few times a second.

let miniOpen = false;
var barOpen = false; // var: sendPresence (from settings) reads it before this line
let miniSent = 0;
let miniArt = { url: null, thumb: null };

function toggleMini(on = !miniOpen) {
  const n = window.lyricPlayerNative;
  if (!n?.mini) { toast('The mini player is part of the desktop app'); return; }
  miniOpen = on;
  $('miniItem').setAttribute('aria-checked', String(on));
  n.mini(on ? 'open' : 'close');
  if (on) { miniSent = 0; setTimeout(sendMiniState, 600); }
}

function currentLines(t) {
  const lines = state.model?.lines || [];
  let i = -1;
  for (let k = 0; k < lines.length; k++) if (lines[k].begin != null && lines[k].begin <= t) i = k;
  return [lines[i] || null, lines[i + 1] || null];
}

/** Floating lyrics: just the line being sung, over everything, click-through. */
function toggleBar(on = !barOpen) {
  const n = window.lyricPlayerNative;
  if (!n?.mini) { toast('Floating lyrics are part of the desktop app'); return; }
  if (!n.appPrefs) { toast('Floating lyrics need the new app: install Lyric Player 2.3.0 or later', { error: true }); return; }
  barOpen = on;
  $('barItem').setAttribute('aria-checked', String(on));
  n.mini(on ? 'open-bar' : 'close-bar').catch(() => {});
  sendTray();
  if (on) { miniSent = 0; setTimeout(sendMiniState, 600); }
}

async function sendMiniState() {
  if (!miniOpen && !barOpen) return;
  miniSent = performance.now();
  if (miniArt.url !== state.artUrl) {
    miniArt = { url: state.artUrl, thumb: null };
    if (state.artUrl) makeThumb(state.artUrl, 160).then((t) => { if (miniArt.url === state.artUrl) { miniArt.thumb = t; sendMiniState(); } }).catch(() => {});
  }
  const t = clock.lyricTime;
  const [line, next] = currentLines(t);
  const pick = (k) => state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || '';
  window.lyricPlayerNative.mini('state', {
    title: pick('title'), artist: pick('artist'), art: miniArt.thumb,
    line: line && { text: line.text, begin: line.begin, end: line.end, words: line.mode === 'word' ? line.words.map((w) => ({ text: w.text, begin: w.begin, end: w.end, spaceBefore: w.spaceBefore })) : [] },
    next: next?.text || '', time: t, position: playback().position, duration: Number.isFinite(playback().duration) ? playback().duration : 0,
    playing: playback().playing, message: state.model ? '' : 'No lyrics', credit: creditText(state.lyricsCredit),
  }).catch(() => {});
}

window.lyricPlayerNative?.onMiniCommand?.(({ cmd }) => {
  if (cmd === 'toggle') togglePlay();
  else if (cmd === 'next') playNext();
  else if (cmd === 'prev') playPrev();
  else if (cmd === 'focus') window.focus();
  else if (cmd === 'close') toggleMini(false);
  else if (cmd === 'closed') { miniOpen = false; $('miniItem').setAttribute('aria-checked', 'false'); }
  else if (cmd === 'bar') toggleBar();
  else if (cmd === 'close-bar') toggleBar(false);
  else if (cmd === 'closed-bar') { barOpen = false; $('barItem').setAttribute('aria-checked', 'false'); sendTray(); }
  else if (cmd === 'settings') { settingsPanel.open(); $('settingsBtn').setAttribute('aria-expanded', 'true'); }
  setTimeout(sendMiniState, 50);
});
for (const ev of ['play', 'pause', 'seeked', 'loadedmetadata']) audio.addEventListener(ev, () => setTimeout(sendMiniState, 30));

// ---------------------------------------------------------------------------
// Find lyrics online (AMLL TTML DB + LRCLIB)

const lyricSearch = new LyricsSearchDialog($('lyricSearch'), {
  options: () => ({ apple: settings.get('appleLyrics') && appleMusicAvailable() }),
  onPick(ttml, result) {
    const safe = `${result.artists[0] ? `${result.artists[0]} - ` : ''}${result.title}`.replace(/[\\/:*?"<>|]+/g, ' ');
    if (!loadTTMLText(ttml, `${safe}.ttml`, { source: result.source })) return;
    const from = result.source === 'amll'
      ? `AMLL TTML DB${result.author ? ` (by @${result.author})` : ''}`
      : SOURCE_NAMES[result.source] || result.source;
    toast(`Lyrics loaded from ${from}${state.songId || state.external ? ' and saved with this song' : ''}`);
  },
});

function openLyricSearch(query) {
  const pick = (k) => state.tagMeta[k] || state.fileMeta[k] || '';
  const guess = [pick('title'), pick('artist')].filter(Boolean).join(' ');
  lyricSearch.open(typeof query === 'string' && query ? query : guess);
}

function toggleLyrics() {
  state.lyricsHidden = !state.lyricsHidden;
  lyricifyBg?.setLyricsMode(!state.lyricsHidden);
  app.classList.toggle('no-lyrics', state.lyricsHidden);
  ui.setLyricsShown(!state.lyricsHidden);
  applyNowPlaying();
  if (!state.lyricsHidden) renderer.remeasure();
}

function toggleTranslation() {
  settings.set('translation', !settings.get('translation'));
}

// Spicy Lyrics' terms: its credit shows wherever its lyrics are on screen.
function creditText(c) {
  if (!c?.provider) return '';
  const who = [c.uploader && `uploaded by ${c.uploader.name}`, c.maker && `made by ${c.maker.name}`].filter(Boolean).join(', ');
  return `Lyrics from ${c.provider}${who ? ` · ${who}` : ''}`;
}

function showCredit() {
  const el = $('lyricsCredit');
  const c = state.lyricsCredit;
  el.hidden = !c?.provider || !state.model;
  if (el.hidden) { el.textContent = ''; return; }
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const link = (p) => (/^https:\/\//.test(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name));
  const parts = [c.uploader && `uploaded by ${link(c.uploader)}`, c.maker && `made by ${link(c.maker)}`].filter(Boolean);
  el.innerHTML = `Lyrics from <a href="https://spicylyrics.org" target="_blank" rel="noopener">${esc(c.provider)}</a>${parts.length ? ` · ${parts.join(', ')}` : ''}`;
}

/** Where the shown lyrics came from; the menu offers to pick others. */
function setLyricsSource(source) {
  state.lyricsSource = source;
  const item = document.querySelector('[data-action="find-lyrics"]');
  if (item) item.textContent = source ? `Lyrics from ${SOURCE_NAMES[source] || source}. Wrong? Find others…` : 'Find lyrics online…';
}

// Romanization borrowed from NetEase / QQ Music for lines with kanji or
// Chinese characters (romanize.js), remembered per song for this visit.
const romanCache = new Map();
async function borrowRomanization(model) {
  const pick = (k) => state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || '';
  const d = playback().duration;
  const info = { title: pick('title'), artist: pick('artist'), duration: Number.isFinite(d) && d > 0 ? d : 0 };
  if (!info.title) return;
  const key = `${info.title}|${info.artist}`.toLowerCase();
  let entries = romanCache.get(key);
  if (entries === undefined) {
    entries = await lookupRomanization(info, { searchNetease, fetchNeteaseLyrics, searchQQ, fetchQQLyrics, qrcLines, lyricsMatch }).catch(() => null);
    romanCache.set(key, entries);
  }
  if (state.model !== model || !entries) return;
  const n = mergeRomanization(model, entries);
  if (n) {
    renderer.setLyrics(model, '');
    diagnostics.note(`romanization borrowed for ${n} lines`);
  }
}

// ---------------------------------------------------------------------------
// Metadata

function metaFromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/^\d{1,3}[\s.\-_]+/, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base || null };
}

function applyMeta() {
  const pick = (k) => state.tagMeta[k] || state.ttmlMeta[k] || state.fileMeta[k] || null;
  ui.setMeta({ title: pick('title') || 'Unknown', artist: pick('artist') || 'Unknown Artist' });
  updateMediaSession(pick('title') || 'Unknown', pick('artist') || '');
  updatePresence();
  // Only save what belongs to this song (shown lyrics may be a previous song's).
  const own = (k) => state.tagMeta[k] || (state.lyricsFor === state.songId ? state.ttmlMeta[k] : null) || state.fileMeta[k];
  const fields = {};
  for (const k of ['title', 'artist']) if (own(k)) fields[k] = own(k);
  remember(fields);
}

let jsmediatagsPromise = null;
function loadJsMediaTags() {
  if (window.jsmediatags) return Promise.resolve(window.jsmediatags);
  jsmediatagsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSMEDIATAGS_URL;
    s.async = true;
    s.onload = () => (window.jsmediatags ? resolve(window.jsmediatags) : reject(new Error('jsmediatags missing')));
    s.onerror = () => { jsmediatagsPromise = null; reject(new Error('Failed to load jsmediatags')); };
    document.head.appendChild(s);
  });
  return jsmediatagsPromise;
}

async function readTags(source) {
  try {
    const lib = await loadJsMediaTags();
    return await new Promise((resolve) => lib.read(source, { onSuccess: (t) => resolve(t.tags), onError: () => resolve(null) }));
  } catch {
    return null;
  }
}

function pictureToUrl(pic) {
  if (!pic?.data?.length) return null;
  let type = (pic.format || '').toLowerCase();
  if (!type.includes('/')) type = type.includes('png') ? 'image/png' : 'image/jpeg';
  return URL.createObjectURL(new Blob([new Uint8Array(pic.data)], { type }));
}

function setArtwork(url, { owned = true, save = true } = {}) {
  if (state.artUrl && state.artOwned) URL.revokeObjectURL(state.artUrl);
  state.artUrl = url;
  state.artOwned = owned && !!url;
  ui.setArtwork(url);
  background_.setImage(url);
  const id = state.songId;
  if (id && save) {
    (url ? makeThumb(url) : Promise.resolve(null))
      .then((thumb) => { if (id === state.songId) remember({ thumb }, { id }); })
      .catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Loading

const ext = (name) => (name.split('.').pop() || '').toLowerCase();

function classify(file) {
  const e = ext(file.name);
  if (AUDIO_EXT.includes(e) || (file.type.startsWith('audio/') && !TTML_EXT.includes(e))) return 'audio';
  if (TTML_EXT.includes(e) || /ttml|xml/.test(file.type)) return 'ttml';
  if (IMAGE_EXT.includes(e) || file.type.startsWith('image/')) return 'image';
  return null;
}

function setAudioSource(src, name, { owned = false } = {}) {
  if (state.audioUrl && state.audioOwned) URL.revokeObjectURL(state.audioUrl);
  state.audioUrl = src;
  state.audioOwned = owned;
  state.audioName = name;
  ui.setBadge(/\.(flac|wav|aiff?|alac)$/i.test(name) ? 'Lossless' : '');
  state.prefsKey = null;
  state.tagMeta = {};
  state.fileMeta = metaFromFilename(name);
  reactor.prepareSource(src);
  state.cover = null;
  state.coverFor = null;
  motion.clear();
  $('removeMotionItem').hidden = true;
  audio.src = src;
  audio.load();
  applyMeta();
}

async function applyTags(source, token, keepArt) {
  const tags = await readTags(source);
  if (token !== state.loadToken) return;
  if (tags) {
    state.tagMeta = { title: tags.title || null, artist: tags.artist || null, album: tags.album || null };
    applyMeta();
  }
  const url = pictureToUrl(tags?.picture);
  if (url) setArtwork(url);
  else if (!keepArt) setArtwork(null);
}

async function loadAudioFile(file, { artwork = null, save = true, lyricsComing = false } = {}) {
  leaveExternal();
  const token = ++state.loadToken;
  state.songId = save ? songId(file) : null;
  if (state.songId) queue.touch(state.songId);
  setAudioSource(URL.createObjectURL(file), file.name, { owned: true });
  let saved = null;
  if (state.songId) {
    const id = state.songId;
    saved = await library.get(id).catch(() => null);
    const fields = { audioName: file.name, audio: file, lastPlayed: Date.now() };
    if (state.pendingTtml) { Object.assign(fields, state.pendingTtml); state.pendingTtml = null; state.lyricsFor = id; }
    remember(fields, { announce: true, id });
    if (token !== state.loadToken) return; // switched to another song meanwhile
    if (fields.ttml) applyMeta(); // lyrics loaded earlier now belong to this song
    // Dropped a song we know: bring its lyrics back too.
    if (saved?.ttml && isExpired(readCredit(saved.ttml))) saved = { ...saved, ttml: null };
    if (!lyricsComing && !fields.ttml && saved?.ttml && token === state.loadToken) {
      state.lyricsFor = id;
      loadTTMLText(saved.ttml, saved.ttmlName || 'lyrics.ttml', { save: false });
      toast(`Lyrics restored for ${saved.title || file.name}`);
    }
  }
  if (artwork) setArtwork(artwork);
  else setArtwork(null);
  await applyTags(file, token, !!artwork);
  restoreCover(saved, token);
  if (state.songId && !lyricsComing && !saved?.ttml && !state.pendingTtml && state.lyricsFor !== state.songId) autoLyrics(token);
}

/** Saved cover for this song, or look one up. */
function restoreCover(rec, token) {
  if (token !== state.loadToken) return;
  if (rec?.cover?.collectionId) setCover(rec.cover);
  else if (rec?.cover?.none) state.coverFor = state.songId;
  else autoCover();
}

// Community TTMLs often list the same artist in several scripts
// ("Taylor Swift", "テイラー・スウィフト", "泰勒·斯威夫特"). Keep the names written in
// the same script as the first one.
const CJK_KANA_HANGUL = /[぀-ヿ㐀-鿿가-힯]/;
function withoutTranslatedNames(names) {
  if (names.length < 2) return names;
  const cjk = CJK_KANA_HANGUL.test(names[0]);
  return names.filter((n) => CJK_KANA_HANGUL.test(n) === cjk);
}

function loadTTMLText(text, name, { save = true, source = null } = {}) {
  let model;
  try {
    model = parseTTML(text);
  } catch (e) {
    toast(`Couldn't read ${name}: ${e.message}`, { error: true });
    return false;
  }
  state.model = model;
  state.ttmlName = name;
  state.ttmlText = text;
  const artist = withoutTranslatedNames(model.meta.artists).join(', ') || Object.values(model.agents).map((a) => a.name).filter(Boolean).join(' & ');
  state.ttmlMeta = { title: model.meta.title, artist: artist || null };
  if (save) state.lyricsFor = state.songId;
  state.lyricsCredit = readCredit(text);
  setLyricsSource(source || (state.lyricsCredit?.provider === 'Spicy Lyrics' ? 'spicy' : null));
  showCredit();
  applyMeta();
  const roman = settings.get('autoRoman') ? romanizeLocally(model) : null;
  renderer.setLyrics(model, 'No lyric lines found in this TTML file.');
  if (roman?.needsLookup && settings.get('romanization')) borrowRomanization(model);
  ui.setTranslation(model.hasTranslation, state.showTranslation);
  if (model.timing === 'none') toast('These lyrics have no timing — showing static lyrics.');
  if (save) {
    if (state.external) savePcLyrics(state.external.key, { ttml: text, name, source });
    else if (state.songId) { remember({ ttmlName: name, ttml: text }); autoCover(); }
    else if (!state.audioName) state.pendingTtml = { ttmlName: name, ttml: text };
  }
  return true;
}

async function loadTTMLFile(file) {
  try {
    loadTTMLText(await file.text(), file.name);
  } catch (e) {
    toast(`Couldn't read ${file.name}: ${e.message}`, { error: true });
  }
}

function handleFiles(files) {
  const list = Array.from(files);
  const lyricsComing = list.some((f) => classify(f) === 'ttml');
  let handled = false;
  for (const f of list) {
    const kind = classify(f);
    if (kind === 'audio') { loadAudioFile(f, { lyricsComing }); handled = true; }
    else if (kind === 'ttml') { loadTTMLFile(f); handled = true; }
    else if (kind === 'image') { setArtwork(URL.createObjectURL(f)); remember({ art: f }); handled = true; }
  }
  if (!handled && list.length) toast(`Unsupported file: ${list[0].name}`, { error: true });
}

async function loadFromQuery() {
  const q = new URLSearchParams(location.search);
  const audioUrl = q.get('audio'), ttmlUrl = q.get('ttml');
  if (ttmlUrl) {
    try {
      const res = await fetch(ttmlUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadTTMLText(await res.text(), decodeURIComponent(ttmlUrl.split('/').pop().split('?')[0]) || 'lyrics.ttml');
    } catch (e) {
      toast(`Couldn't load TTML from URL: ${e.message}`, { error: true });
    }
  }
  if (audioUrl) {
    leaveExternal();
    const token = ++state.loadToken;
    const name = decodeURIComponent(audioUrl.split('/').pop().split('?')[0]) || 'audio';
    state.songId = null;
    setAudioSource(audioUrl, name);
    setArtwork(null);
    applyTags(new URL(audioUrl, location.href).href, token, false);
  }
}

async function loadDemo() {
  const { buildDemoAudio, buildDemoTTML, buildDemoArtwork } = await import('./demo.js');
  leaveExternal();
  const art = await buildDemoArtwork();
  state.songId = null;
  loadTTMLText(buildDemoTTML(), 'demo.ttml', { save: false });
  await loadAudioFile(buildDemoAudio(), { artwork: URL.createObjectURL(art), save: false, lyricsComing: true });
}

// ---------------------------------------------------------------------------
// Drag & drop
let dragDepth = 0;
addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  if (dragDepth++ === 0) document.body.classList.add('dragover');
});
addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragover'); }
});
addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  document.body.classList.toggle('over-art', !!e.target.closest?.('#art'));
});
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragover', 'over-art');
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

for (const id of ['audioInput', 'ttmlInput']) {
  $(id).addEventListener('change', (e) => {
    if (e.target.files.length) handleFiles(e.target.files);
    e.target.value = '';
  });
}

// ---------------------------------------------------------------------------
// Audio events

audio.addEventListener('loadedmetadata', loadPrefs);

// Media keys / system media controls (keyboard play-pause, Windows flyout).
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const handlers = {
    play: () => audio.play().catch(() => {}),
    pause: () => audio.pause(),
    seekbackward: () => seek(audio.currentTime - 10),
    seekforward: () => seek(audio.currentTime + 10),
    seekto: (d) => seek(d.seekTime),
    previoustrack: () => playPrev(),
    nexttrack: () => playNext(),
  };
  handlers.play = () => (state.external ? pcCommand('play') : audio.play().catch(() => {}));
  handlers.pause = () => (state.external ? pcCommand('pause') : audio.pause());
  for (const [k, fn] of Object.entries(handlers)) { try { ms.setActionHandler(k, fn); } catch { /* unsupported */ } }
  audio.addEventListener('play', () => { ms.playbackState = 'playing'; });
  audio.addEventListener('pause', () => { ms.playbackState = 'paused'; });
}
function updateMediaSession(title, artist) {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title, artist, artwork: state.artUrl ? [{ src: state.artUrl, sizes: '512x512' }] : [],
  });
}
audio.addEventListener('volumechange', savePrefs);
audio.addEventListener('error', () => {
  if (!audio.src) return;
  toast(`Can't play ${state.audioName || 'this file'} — the format may not be supported by this browser.`, { error: true });
});

// ---------------------------------------------------------------------------
// Keyboard

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const key = e.key;
  showControls();
  if (key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
  if (key === ' ' || key === 'Spacebar') {
    if (e.target.closest?.('button')) return; // let buttons handle their own activation
    e.preventDefault();
    togglePlay();
  } else if (key === 'ArrowLeft') { e.preventDefault(); seek(playback().position - 5); }
  else if (key === 'ArrowRight') { e.preventDefault(); seek(playback().position + 5); }
  else if (key === 'ArrowUp' || key === 'ArrowDown') {
    e.preventDefault();
    audio.volume = Math.min(1, Math.max(0, Math.round((audio.volume + (key === 'ArrowUp' ? 0.05 : -0.05)) * 100) / 100));
    toast(`Volume ${Math.round(audio.volume * 100)}%`, { key: 'volume', ms: 1200 });
  } else if (key === '[') setOffset(clock.offsetMs - 50);
  else if (key === ']') setOffset(clock.offsetMs + 50);
  else if (key === 'f' || key === 'F') toggleFullscreen();
  else if (key === 's' || key === 'S') settingsPanel.toggle();
  else if (key === 'm' || key === 'M') settings.set('layout', settings.get('layout') === 'apple' ? 'standard' : 'apple');
  else if (key === 'c' || key === 'C') openArtSearch();
  else if (key === 'n' || key === 'N') playNext();
  else if (key === 'p' || key === 'P') playPrev();
  else if (key === 'q' || key === 'Q') libraryPanel.toggle('next');
  else if (key === 'e' || key === 'E') syncEditor.open();
  else if (key === 'i' || key === 'I') toggleMini();
  else if (key === 'k' || key === 'K') toggleBar();
  else if (key === '/') { e.preventDefault(); openLyricSearch(); }
  else if (key === 'l' || key === 'L') {
    toggleLyrics();
  }
});

// ---------------------------------------------------------------------------
// Frame loop

let last = performance.now();
var windowHidden = false;
native?.onWindowState?.((w) => { windowHidden = w.visible === false; });
function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const media = clock.tick(now);
  const playing = clock.playing;
  // Hidden in the tray or minimized: nothing to draw.
  if (!app.hidden && !windowHidden) {
    ui.update(media, dt, playing);
    if (!state.lyricsHidden) renderer.update(clock.lyricTime, dt, playing);
    reactor.update(dt, playing);
    if (!glassWindowOk || !settings.get('macGlass')) background.update(dt, playing, reactor);
  }
  if (syncEditor.isOpen) syncEditor.update(clock.lyricTime);
  if ((miniOpen || barOpen) && now - miniSent > 400) sendMiniState();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (new URLSearchParams(location.search).has('audio') || new URLSearchParams(location.search).has('ttml')) loadFromQuery();
else restoreLastSong();
syncFolders();
window.lyricPlayerNative?.onLibraryChanged?.(() => syncFolders());

// ---------------------------------------------------------------------------
// Library: songs are remembered between visits (in this browser, or for the
// desktop app also straight from your music folders)

let refreshTimer = 0;
function refreshLibrary() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => libraryPanel.refresh(), 150);
}

function remember(fields, { announce = false, id = state.songId } = {}) {
  if (!id) return;
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  rememberChain = rememberChain
    .then(() => library.update(id, clean))
    .then(() => refreshLibrary())
    .catch((e) => {
      if (announce) toast(`Couldn't save this song for next time (${e.name === 'QuotaExceededError' ? 'storage is full' : e.message})`, { error: true });
    });
}

const mediaUrl = (p) => `media://track/?p=${encodeURIComponent(p)}`;

/** Tags and cover of a song in a music folder, read by the desktop app. */
async function applyNativeTags(rec, token, keepArt) {
  const info = await window.lyricPlayerNative.music('track-info', { path: rec.path }).catch(() => null);
  if (token !== state.loadToken) return;
  if (info) {
    state.tagMeta = { title: info.title || null, artist: info.artist || null, album: info.album || null };
    ui.setBadge(info.lossless ? 'Lossless' : '');
    applyMeta();
  }
  const pic = info?.picture;
  if (pic?.data?.length) setArtwork(URL.createObjectURL(new Blob([pic.data], { type: pic.format || 'image/jpeg' })));
  else if (!keepArt) setArtwork(null);
}

async function openSong(id, { autoplay = false } = {}) {
  const rec = await library.get(id).catch(() => null);
  if (!rec?.audio && !rec?.path) { toast('That song is no longer available.', { error: true }); refreshLibrary(); return false; }
  leaveExternal();
  const token = ++state.loadToken;
  state.songId = id;
  state.pendingTtml = null;
  state.lyricsFor = id;
  queue.touch(id);
  let ttml = rec.ttml, ttmlName = rec.ttmlName;
  if (ttml && isExpired(readCredit(ttml))) ttml = null; // Spicy Lyrics: fetched again after 30 days
  if (!ttml && rec.ttmlPath) {
    ttml = await window.lyricPlayerNative?.music('read-ttml', { path: rec.ttmlPath }).catch(() => null);
    ttmlName = rec.ttmlPath.split(/[\\/]/).pop();
    if (token !== state.loadToken) return false;
  }
  if (ttml) loadTTMLText(ttml, ttmlName || 'lyrics.ttml', { save: false });
  else { state.model = null; state.ttmlName = null; state.ttmlMeta = {}; renderer.setLyrics(null, settings.get('autoLyrics') ? 'Looking for lyrics…' : 'No lyrics saved for this song — drop a .ttml file, or press / to find them online'); }
  if (rec.path) setAudioSource(mediaUrl(rec.path), rec.audioName || rec.path.split(/[\\/]/).pop(), { owned: false });
  else setAudioSource(URL.createObjectURL(rec.audio), rec.audioName || 'audio', { owned: true });
  if (rec.path && rec.title) { state.tagMeta = { title: rec.title, artist: rec.artist || null, album: rec.album || null }; applyMeta(); }
  remember({ lastPlayed: Date.now() });
  if (autoplay) audio.play().catch(() => {});
  if (rec.art) setArtwork(URL.createObjectURL(rec.art));
  else setArtwork(null);
  if (rec.path) await applyNativeTags(rec, token, !!rec.art);
  else await applyTags(rec.audio, token, !!rec.art);
  restoreCover(rec, token);
  if (!ttml) autoLyrics(token, rec.duration);
  return true;
}

async function restoreLastSong() {
  const songs = await library.list().catch(() => []);
  if (!songs.length) return;
  const last = (queue.current && songs.find((s) => s.id === queue.current)) || songs[0];
  if (await openSong(last.id)) toast(`Welcome back — ${last.title || last.audioName}`, { ms: 2000 });
}

// ---------------------------------------------------------------------------
// Queue: next / previous, shuffle, repeat, Up Next

function playQueued(id) {
  if (!id) return false;
  if (id === state.songId) { seek(0); audio.play().catch(() => {}); return true; }
  openSong(id, { autoplay: true });
  return true;
}

function playNext({ auto = false } = {}) {
  if (state.external && !auto) { pcCommand('next'); return true; }
  const id = queue.next({ auto });
  if (id) return playQueued(id);
  if (!auto) toast('End of the queue');
  return false;
}

function playPrev() {
  if (state.external) { pcCommand('prev'); return; }
  // Like every player: past the first few seconds, "previous" restarts the song.
  if (audio.currentTime > 3 || !queue.items.length) { seek(0); return; }
  const id = queue.prev();
  if (id) playQueued(id);
  else seek(0);
}

audio.addEventListener('ended', () => playNext({ auto: true }));

// ---------------------------------------------------------------------------
// Library sheet (☰ or Q): Up Next, Songs (incl. music folders), Playlists.

// var: the settings subscription and early loads can run before this line.
var libraryPanel = new LibraryPanel($('librarySheet'), {
  library,
  queue,
  desktop: !!native?.music,
  currentId: () => state.songId,
  play(ids, startId) { playQueued(queue.set(ids, startId)); },
  jump(index) { playQueued(queue.jump(index)); },
  async forget(id) {
    await library.remove(id).catch(() => {});
    queue.removeId(id);
    queue.changed();
    if (id === state.songId) state.songId = null;
  },
  folders: () => native.music('folders'),
  async addFolder() {
    const r = await native.music('add-folder').catch((e) => { toast(`Couldn't add the folder (${e.message})`, { error: true }); return null; });
    if (r) { toast('Scanning your music…', { key: 'scan' }); await syncFolders({ announce: true }); }
    return r;
  },
  async removeFolder(dir) {
    await native.music('remove-folder', { folder: dir });
    await syncFolders();
  },
  showInFolder: (p) => native.music('show', { path: p }),
  toast: (m) => toast(m, { ms: 1600 }),
  onClose: () => $('queueBtn').setAttribute('aria-expanded', 'false'),
});
queue.onChange(() => refreshLibrary());

$('queueBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  libraryPanel.toggle();
  $('queueBtn').setAttribute('aria-expanded', String(libraryPanel.isOpen));
});
document.addEventListener('pointerdown', (e) => {
  if (libraryPanel.isOpen && !e.target.closest('#librarySheet, #queueBtn, .row-menu')) libraryPanel.close();
});
bindWindowControls({ onFullscreen: toggleFullscreen });

// ---------------------------------------------------------------------------
// Music playing on this PC (desktop app): when Spotify, Apple Music, a browser
// or any app with Windows media controls starts playing and this app isn't,
// show its song, cover and lyrics, following its position. The music stays
// in that app; nothing is recorded or copied.

const sys = new SystemPlayback();
var pcState = { available: !!native?.systemMedia, raw: null, info: null, lyricsNote: '', started: false };
const PC_LYRICS = 'lyricplayer:pcLyrics';

function startSystemMedia(on) {
  if (!pcState.available || on === pcState.started) return;
  pcState.started = on;
  native.systemMedia(on ? 'start' : 'stop').catch(() => {});
  if (!on) {
    pcState.raw = null;
    pcState.info = null;
    if (state.external) { leaveExternal(); clearSong(); }
  }
}

function pcCommand(cmd, value) {
  native?.systemMedia('command', { cmd, value }).catch(() => {});
}

native?.onSystemMedia?.((raw) => {
  if (!pcState.started) return;
  if (raw?.none) raw = null;
  const prev = pcState.raw;
  pcState.raw = raw;
  pcState.info = raw ? normalizeTrack(raw) : null;
  sys.update(raw || (prev ? { ...prev, status: 'Stopped' } : null));
  const changed = (prev?.track || null) !== (raw?.track || null) || prev?.status !== raw?.status || (!!prev?.thumb) !== (!!raw?.thumb);
  if (state.external) {
    if (raw && raw.track !== state.external.key) followPc(raw); // the other app moved to another song
    else {
      if (raw?.thumb && !prev?.thumb) setArtwork(raw.thumb, { owned: false, save: false });
      if (changed) updatePresence();
    }
  } else if (raw && raw.status === 'Playing' && (audio.paused || audio.ended || !audio.src) && settings.get('followPc')
      && (prev?.status !== 'Playing' || prev?.track !== raw.track)) {
    followPc(raw);
  }
});

// This app starting to play pauses the other app, like switching players.
audio.addEventListener('play', () => {
  if (state.external) return;
  if (pcState.raw?.status === 'Playing') pcCommand('pause');
});

function readPcLyrics() {
  try { return JSON.parse(localStorage.getItem(PC_LYRICS) || '[]'); } catch { return []; }
}
function savePcLyrics(key, entry) {
  const list = readPcLyrics().filter((x) => x.key !== key);
  list.unshift({ key, ...entry });
  // Keep the last songs that fit (TTMLs can be big).
  for (let n = Math.min(list.length, 25); n > 0; n--) {
    try { localStorage.setItem(PC_LYRICS, JSON.stringify(list.slice(0, n))); return; } catch { /* full: keep fewer */ }
  }
}

function leaveExternal() {
  if (!state.external) return;
  state.external = null;
  clock.external = null;
  clock.last = audio.currentTime;
  ui.getDuration = () => audio.duration;
  state.prefsKey = null;
}

/** Nothing loaded (e.g. the followed app went away and following was turned off). */
function clearSong() {
  state.model = null; state.ttmlName = null; state.ttmlText = null;
  state.lyricsCredit = null; showCredit();
  state.tagMeta = {}; state.ttmlMeta = {}; state.fileMeta = {};
  renderer.setLyrics(null, '');
  setArtwork(null, { save: false });
  applyMeta();
}

function followPc(raw) {
  const info = normalizeTrack(raw);
  const token = ++state.loadToken;
  if (!audio.paused) audio.pause();
  state.external = { key: raw.track, app: info.app };
  clock.external = sys;
  ui.getDuration = () => sys.duration;
  state.songId = null;
  state.lyricsFor = null;
  state.pendingTtml = null;
  state.tagMeta = { title: info.title || null, artist: info.artist || null, album: info.album || null };
  state.fileMeta = {};
  state.ttmlMeta = {};
  state.cover = null;
  state.coverFor = null;
  motion.clear();
  $('removeMotionItem').hidden = true;
  ui.setBadge('');
  // Lyric offset per followed song (apps report their position a little late or early).
  state.prefsKey = `lyricplayer:pc:${raw.track}`;
  let prefs = null;
  try { prefs = JSON.parse(localStorage.getItem(state.prefsKey) || 'null'); } catch { /* storage unavailable */ }
  let appOffset = 0;
  try { appOffset = Number(localStorage.getItem(pcAppOffsetKey(info.app))) || 0; } catch { /* storage unavailable */ }
  setOffset(Number.isFinite(prefs?.offset) ? prefs.offset : appOffset, false);
  state.model = null; state.ttmlName = null; state.ttmlText = null;
  state.lyricsCredit = null; showCredit();
  pcState.lyricsNote = 'Looking for lyrics…';
  renderer.setLyrics(null, 'Looking for lyrics…');
  ui.setTranslation(false, state.showTranslation);
  applyMeta();
  setArtwork(raw.thumb || null, { owned: false, save: false });
  refreshLibrary();
  diagnostics.note(`following ${info.app}: "${info.title}"`);
  pcCover(token, info);
  pcLyrics(token, info, raw.duration);
}

/** Apple Music cover (and animated cover) for the followed song. */
async function pcCover(token, info) {
  if (!info.title || !info.artist || !(settings.get('autoArt') || settings.get('motionArt'))) return;
  try {
    const album = await findAlbum(info);
    if (token !== state.loadToken || !album) return;
    let m = { square: null, tall: null };
    try { m = await fetchMotionArt(album.collectionId, album.storefront); } catch { /* still cover only */ }
    if (token !== state.loadToken) return;
    setCover({ collectionId: album.collectionId, album: album.album, artwork: album.artwork, square: m.square, tall: m.tall, useArt: !state.artUrl });
    if (!state.tagMeta.album) state.tagMeta.album = album.album;
  } catch { /* offline */ }
}

async function pcLyrics(token, info, duration) {
  const done = (note) => { pcState.lyricsNote = note; };
  let saved = readPcLyrics().find((x) => x.key === state.external?.key);
  if (saved?.ttml && isExpired(readCredit(saved.ttml))) saved = null;
  if (saved?.ttml) {
    loadTTMLText(saved.ttml, saved.name || 'lyrics.ttml', { save: false, source: saved.source || null });
    done(`Lyrics${saved.source ? ` from ${SOURCE_NAMES[saved.source] || saved.source}` : ''} (saved)`);
    return;
  }
  if (!info.title) { renderer.setLyrics(null, 'No song title from the app'); done(''); return; }
  if (!settings.get('autoLyrics')) { renderer.setLyrics(null, 'Press / to find lyrics for this song'); done('Automatic lyrics are off'); return; }
  try {
    const { results } = await searchLyrics([info.title, info.artist].filter(Boolean).join(' '), { apple: settings.get('appleLyrics') && appleMusicAvailable(), song: { title: info.title, artist: info.artist, duration: duration > 0 ? duration : 0 } });
    if (token !== state.loadToken) return;
    const best = pickBestLyrics(results, { title: info.title, artist: info.artist, duration: duration > 0 ? duration : 0 });
    if (!best) { renderer.setLyrics(null, 'No lyrics found for this song — press / to search yourself'); done('No lyrics found. Press / in the player to search.'); return; }
    const ttml = await getTtml(best);
    if (token !== state.loadToken || state.model) return;
    const safe = `${best.artists[0] ? `${best.artists[0]} - ` : ''}${best.title}`.replace(/[\\/:*?"<>|]+/g, ' ');
    if (loadTTMLText(ttml, `${safe}.ttml`, { save: false, source: best.source })) {
      savePcLyrics(state.external.key, { ttml, name: `${safe}.ttml`, source: best.source });
      done(`Lyrics from ${SOURCE_NAMES[best.source] || best.source}`);
      diagnostics.note(`pc lyrics: ${best.source} for "${info.title}"`);
    }
  } catch (e) {
    if (token === state.loadToken) { renderer.setLyrics(null, 'Couldn’t look for lyrics (offline?) — press / to search'); done('Couldn’t look for lyrics'); }
    diagnostics.error('pc lyrics', e);
  }
}

startSystemMedia(!!settings.get('followPc'));

// Started fine (an in-app update that doesn't get here is rolled back), then
// look for a newer version on your website.
native?.update?.('booted').catch(() => {});
setTimeout(() => showWhatsNew().catch(() => {}), 1500);
if (native?.update && settings.get('autoUpdate') && !navigator.webdriver) {
  setTimeout(() => native.update('check', { site: updateSite(settings), auto: true }).catch(() => {}), 8000);
}

/** Music folders (desktop app): add new files, update changed ones, drop deleted ones. */
var syncing = null; // var: syncFolders() runs at startup, above this line
async function syncFolders({ announce = false } = {}) {
  const music = window.lyricPlayerNative?.music;
  if (!music) return;
  if (syncing) return syncing;
  syncing = (async () => {
    const tracks = await music('scan').catch(() => null);
    if (!tracks) return;
    const existing = (await library.list().catch(() => [])).filter((s) => s.path);
    const byPath = new Map(existing.map((s) => [s.path, s]));
    const updates = [];
    for (const t of tracks) {
      const cur = byPath.get(t.path);
      byPath.delete(t.path);
      if (cur && cur.mtime === t.mtime && cur.ttmlPath === t.ttmlPath) continue;
      const guess = metaFromFilename(t.name);
      updates.push([`file:${t.path}`, {
        path: t.path, audioName: t.name, folder: t.folder, mtime: t.mtime, size: t.size,
        title: t.title || guess.title, artist: t.artist || guess.artist || null, album: t.album || null,
        duration: t.duration || null, track: t.track || null, disc: t.disc || null, lossless: !!t.lossless, ttmlPath: t.ttmlPath,
      }]);
    }
    await library.updateMany(updates).catch(() => {});
    const gone = [...byPath.values()].map((s) => s.id);
    if (gone.length) {
      await library.removeMany(gone).catch(() => {});
      const valid = new Set((await library.list().catch(() => [])).map((s) => s.id));
      queue.prune(valid);
    }
    refreshLibrary();
    if (announce) toast(`${tracks.length} song${tracks.length === 1 ? '' : 's'} in your music folders`, { key: 'scan' });
  })().finally(() => { syncing = null; });
  return syncing;
}

// ---------------------------------------------------------------------------
// Automatic lyrics: when a song has none, search every source and take the
// best match (Settings → Lyrics → Find lyrics automatically).

async function autoLyrics(token, knownDuration = 0) {
  if (!settings.get('autoLyrics') || !state.songId || state.lyricsFor === state.songId && state.model) return;
  const id = state.songId;
  const info = songInfo();
  if (!info.title) { renderer.setLyrics(null, 'No lyrics saved for this song — drop a .ttml file, or press / to find them online'); return; }
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : knownDuration || 0;
  try {
    const { results } = await searchLyrics([info.title, info.artist].filter(Boolean).join(' '), { apple: settings.get('appleLyrics') && appleMusicAvailable(), song: { ...info, duration } });
    if (token !== state.loadToken || id !== state.songId) return;
    const best = pickBestLyrics(results, { ...info, duration });
    if (!best) {
      renderer.setLyrics(null, 'No lyrics found for this song — drop a .ttml file, or press / to search yourself');
      return;
    }
    const ttml = await getTtml(best);
    if (token !== state.loadToken || id !== state.songId || (state.lyricsFor === id && state.model)) return;
    const safe = `${best.artists[0] ? `${best.artists[0]} - ` : ''}${best.title}`.replace(/[\\/:*?"<>|]+/g, ' ');
    if (loadTTMLText(ttml, `${safe}.ttml`, { source: best.source })) {
      toast(`Lyrics found on ${SOURCE_NAMES[best.source] || best.source} — press / to pick different ones`, { ms: 3200 });
      diagnostics.note(`auto lyrics: ${best.source} for "${info.title}"`);
    }
  } catch (e) {
    if (token === state.loadToken) renderer.setLyrics(null, 'Couldn’t look for lyrics (offline?) — press / to search');
    diagnostics.error('auto lyrics', e);
  }
}

// Handle for debugging / scripting from the console.
window.lyricPlayer = { lyricifyBg, motion, queue, libraryPanel, demo: loadDemo, followPc, pcState, get external() { return state.external; }, syncFolders, get cover() { return state.cover; }, audio, clock, renderer, ui, get background() { return background; }, amllBg, artworkBg, reactor, library, settings, loadTTMLText };
