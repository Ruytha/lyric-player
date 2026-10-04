// Player settings: schema, defaults and persistence (localStorage, per browser).
// The settings sheet (settings-panel.js) is generated from SCHEMA.

import { LANGUAGES, defaultLanguage } from './translate.js';

const KEY = 'lyricplayer:settings';

/**
 * type: 'range' (min/max/step, fmt) | 'toggle' | 'choice' (options) | 'text'
 *       (placeholder, max length) | 'custom' (a row the page builds itself; no value)
 * desktop: only shown in the desktop app. Sections are rendered in order.
 */
export const SCHEMA = [
  { section: 'Lyrics' },
  { key: 'lyricSize', label: 'Size', type: 'range', min: 0.6, max: 1.6, step: 0.05, def: 1, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'lyricWeight', label: 'Weight', type: 'range', min: 400, max: 900, step: 100, def: 700, fmt: (v) => String(v) },
  { key: 'letterSpacing', label: 'Letter spacing', type: 'range', min: -0.06, max: 0.06, step: 0.005, def: -0.02, fmt: (v) => `${v > 0 ? '+' : ''}${v.toFixed(3)}em` },
  { key: 'bloom', label: 'Bloom', hint: 'Glow around the line being sung', type: 'range', min: 0, max: 1, step: 0.01, def: 0.35, fmt: pct },
  { key: 'wordFade', label: 'Sweep softness', hint: 'Width of the soft edge as words light up', type: 'range', min: 0.1, max: 1.5, step: 0.05, def: 0.5, fmt: (v) => `${v.toFixed(2)}em` },
  { key: 'alignPosition', label: 'Focus position', hint: 'Where the current line sits, from the top', type: 'range', min: 0.1, max: 0.6, step: 0.01, def: 0.35, fmt: pct },
  { key: 'lyricFont', label: 'Font', type: 'choice', def: 'default', options: [['default', 'Default'], ['rounded', 'Rounded'], ['serif', 'Serif'], ['mono', 'Mono'], ['playful', 'Playful']] },
  { key: 'lyricColor', label: 'Colour', hint: 'Cover: a light colour taken from the album cover', type: 'choice', def: 'white', options: [['white', 'White'], ['cover', 'Cover'], ['warm', 'Warm'], ['pink', 'Pink'], ['mint', 'Mint'], ['sky', 'Sky'], ['lilac', 'Lilac']], select: true },
  { key: 'lineBlur', label: 'Blur other lines', type: 'toggle', def: true },
  { key: 'lineScale', label: 'Zoom current line', type: 'toggle', def: true },
  { key: 'springs', label: 'Spring motion', type: 'toggle', def: true },
  { key: 'hidePassed', label: 'Hide sung lines', type: 'toggle', def: false },
  { key: 'autoLyrics', label: 'Find lyrics automatically', hint: 'When a song has no lyrics, search every source and use the best match', type: 'toggle', def: true },
  { key: 'translation', label: 'Translation', type: 'toggle', def: false },
  { key: 'romanization', label: 'Romanization', type: 'toggle', def: true },
  { key: 'translateTo', label: 'Translate lyrics to', hint: 'For ••• › Translate Lyrics, when the lyrics have no translation', type: 'choice', def: defaultLanguage(), options: LANGUAGES, select: true },
  { key: 'lookupWriters', label: 'Find songwriters online', hint: 'When the lyrics don’t list who wrote the song, look it up on MusicBrainz and show it after the last line', type: 'toggle', def: true },
  { key: 'autoRoman', label: 'Romanize when missing', hint: 'Korean and Japanese kana are romanized here; lines with kanji or Chinese characters borrow NetEase or QQ Music’s romanization for the same song', type: 'toggle', def: true },

  { section: 'Background' },
  { key: 'bgStyle', label: 'Style', hint: 'Lyricify: the Apple Music (iOS) background ported from Lyricify Backgrounds by WXRIW', type: 'choice', def: 'lyricify', options: [['lyricify', 'Lyricify'], ['amll', 'AMLL mesh'], ['artwork', 'Blurred']] },
  { key: 'bgFlow', label: 'Flow speed', type: 'range', min: 0, max: 4, step: 0.1, def: 1, fmt: (v) => `${v.toFixed(1)}×` },
  { key: 'bgReact', label: 'Music reaction', hint: 'How strongly the background follows the bass', type: 'range', min: 0, max: 1, step: 0.01, def: 0.6, fmt: pct },
  { key: 'bgPulse', label: 'Beat pulse', hint: 'Zoom on each kick drum', type: 'range', min: 0, max: 1, step: 0.01, def: 0.5, fmt: pct },
  { key: 'bgDim', label: 'Dim', type: 'range', min: 0, max: 0.7, step: 0.01, def: 0.25, fmt: pct },
  { key: 'bgScale', label: 'Render quality', hint: 'Lower is lighter on the GPU', type: 'range', min: 0.25, max: 1, step: 0.05, def: 0.5, fmt: pct },
  { key: 'bgFps', label: 'Frame rate', type: 'range', min: 15, max: 144, step: 1, def: 60, fmt: (v) => `${v} fps` },
  { key: 'bgStatic', label: 'Still background', hint: 'Stops the motion to save power', type: 'toggle', def: false },
  { key: 'macGlass', label: 'Liquid Glass window', hint: 'macOS 26: the window becomes real Liquid Glass with your desktop showing through, instead of the cover background', type: 'toggle', def: false, desktop: true, mac: true },

  { section: 'Playback' },
  { key: 'automix', label: 'AutoMix', hint: 'Like Apple Music: songs blend into each other in time with the beat, the next one sped up or slowed down a little to match. Your own songs; replaces Crossfade', type: 'toggle', def: false },
  { key: 'crossfade', label: 'Crossfade', hint: 'Your own songs fade into the next one', type: 'range', min: 0, max: 12, step: 1, def: 0, fmt: (v) => (v ? `${v} s` : 'Off') },
  { key: 'eqOn', label: 'Equalizer', type: 'toggle', def: false },
  { key: 'eqRow', type: 'custom' },
  { key: 'eqGains', type: 'text', def: '0,0,0,0,0,0,0,0,0,0', max: 100, hidden: true },
  { key: 'levelVolume', label: 'Even out volume', hint: 'Quiet songs are turned up and loud ones down, so every song plays about as loud (your own songs)', type: 'toggle', def: false },
  { key: 'karaoke', label: 'Karaoke', hint: 'Turns the lead vocal down on your own songs. Works best on songs with the voice in the middle; some echo of it stays', type: 'toggle', def: false },
  { key: 'smartShuffle', label: 'Smart shuffle', hint: 'Shuffle plays songs you haven’t heard lately first and mixes up the artists', type: 'toggle', def: true },

  { section: 'Artwork' },
  { key: 'autoArt', label: 'Find covers automatically', hint: 'Looks up the song on Apple Music: animated cover, or the cover if the file has none', type: 'toggle', def: true },
  { key: 'motionArt', label: 'Animated covers', hint: 'Play moving covers when an album has one', type: 'toggle', def: true },
  { key: 'sideCover', label: 'Animated cover beside the lyrics', hint: 'In a wide window, the tall animated cover fills the left side, with the lyrics on the right', type: 'toggle', def: false },

  { section: 'Apple Music', desktop: true },
  { key: 'appleAccount', type: 'custom', desktop: true },
  { key: 'appleLyrics', label: 'Apple Music lyrics in Find lyrics', hint: 'Word-synced lyrics from your own Apple Music subscription, shown first in Find lyrics', type: 'toggle', def: true, desktop: true },

  { section: 'On This PC', iosSection: 'Apple Music', desktop: true, ios: true },
  { key: 'followPc', ios: true, iosLabel: 'Follow the Music app', iosHint: 'When the Music app plays and Lyric Player doesn’t, show its song, cover and synced lyrics. iOS doesn’t let apps see what Spotify or other apps play', label: 'Follow music playing on this PC', hint: 'When Spotify, Apple Music, a browser or another app plays and Lyric Player doesn’t, show its song, cover and synced lyrics', type: 'toggle', def: true, desktop: true },

  { section: 'App', desktop: true },
  { key: 'tray', label: 'Keep running in the tray', hint: 'Closing the window leaves Lyric Player running, with an icon by the clock (Windows) or in the menu bar (Mac), still following your music. Quit from its menu there', type: 'toggle', def: false, desktop: true },
  { key: 'startup', label: 'Open when you sign in', type: 'toggle', def: false, desktop: true },
  { key: 'hotkeys', label: 'Global shortcuts', hint: 'Control the music from any app, even when Lyric Player is in the tray', type: 'toggle', def: true, desktop: true },
  { key: 'hotkeysInfo', type: 'custom', desktop: true },
  { key: 'startHidden', label: 'Start in the tray', hint: 'When it opens at sign-in, wait in the tray instead of opening the window', type: 'toggle', def: true, desktop: true },

  { section: 'Phone remote', desktop: true },
  { key: 'remote', label: 'Phone remote', hint: 'Control the music and see the lyrics on your phone, over your home Wi-Fi', type: 'toggle', def: false, desktop: true },
  { key: 'remoteInfo', type: 'custom', desktop: true },

  { section: 'Discord', desktop: true },
  { key: 'discord', label: 'Discord Rich Presence', hint: 'Shows what you are playing on your Discord profile (the Discord app must be open)', type: 'toggle', def: false, desktop: true },
  { key: 'discordStatus', type: 'custom', desktop: true },
  { key: 'discordAppId', label: 'Application ID', hint: 'From discord.com/developers/applications. Your application\u2019s name is what Discord shows, as in "Listening to Lyric Player"', type: 'text', def: '', placeholder: 'e.g. 1234567890123456789', max: 24, desktop: true },
  { key: 'discordDetails', label: 'First line', hint: 'Use {title}, {artist}, {album}', type: 'text', def: '{title}', placeholder: '{title}', max: 128, desktop: true },
  { key: 'discordState', label: 'Second line', type: 'text', def: '{artist}', placeholder: '{artist}', max: 128, desktop: true },
  { key: 'discordImageText', label: 'Cover hover text', type: 'text', def: '{album}', placeholder: '{album}', max: 128, desktop: true },
  { key: 'discordTime', label: 'Song length and progress', type: 'toggle', def: true, desktop: true },
  { key: 'discordPaused', label: 'Show while paused', type: 'toggle', def: false, desktop: true },
  { key: 'discordCover', label: 'Cover', type: 'choice', def: 'animated', options: [['animated', 'Animated'], ['still', 'Still'], ['none', 'None']], desktop: true },

  { section: 'Last.fm', desktop: true },
  { key: 'lastfm', label: 'Scrobble to Last.fm', hint: 'Adds songs to your Last.fm profile once you’ve heard half (or 4 minutes)', type: 'toggle', def: false, desktop: true },
  { key: 'lastfmAccount', type: 'custom', desktop: true },
  { key: 'lastfmKey', label: 'API key', type: 'text', def: '', placeholder: '32 characters', max: 40, desktop: true },
  { key: 'lastfmSecret', label: 'Shared secret', type: 'text', def: '', placeholder: '32 characters', max: 40, desktop: true, secret: true },

  { section: 'Fun' },
  { key: 'emojiReactions', label: 'Emoji reactions', hint: 'Emoji float up when words like love, fire, money, stars or dance are sung', type: 'toggle', def: false },
  { key: 'emojiWords', label: 'Your emoji words', hint: 'Add your own: word=emoji, separated by commas. Example: pizza=🍕, cat=🐈 😺', type: 'text', def: '', placeholder: 'pizza=🍕, cat=🐈', max: 400 },

  { section: 'Interface' },
  { key: 'layout', label: 'Layout', type: 'choice', def: 'standard', options: [['standard', 'Standard'], ['apple', 'Apple Music']] },
  { key: 'glass', label: 'Liquid Glass', hint: 'Refractive glass controls (full effect in Chrome, Edge and the app)', type: 'toggle', def: true },

  { section: 'About' },
  { key: 'about', type: 'custom' },
  { key: 'site', label: 'Update website', hint: 'Where the app gets updates (and Discord’s animated covers). Leave empty for the official one, files.ruytha.dev/update/lyricviewer', type: 'text', def: '', placeholder: 'https://files.ruytha.dev/update/lyricviewer', max: 200, desktop: true },
  { key: 'autoUpdate', label: 'Update automatically', hint: 'Downloads new versions from your website in the background and uses them from the next start', type: 'toggle', def: true, desktop: true },
];

function pct(v) { return `${Math.round(v * 100)}%`; }

export const DEFAULTS = Object.fromEntries(SCHEMA.filter((s) => s.key && s.type !== 'custom').map((s) => [s.key, s.def]));

export class Settings {
  constructor() {
    this.values = { ...DEFAULTS };
    // The iPhone app starts in the iPhone lyrics layout (Apple Music Mode).
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('ios')) this.values.layout = 'apple';
    this.listeners = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && typeof saved === 'object') {
        for (const s of SCHEMA) {
          if (!s.key || !(s.key in saved)) continue;
          const v = saved[s.key];
          if (s.type === 'range' && Number.isFinite(v)) this.values[s.key] = Math.min(s.max, Math.max(s.min, v));
          else if (s.type === 'toggle' && typeof v === 'boolean') this.values[s.key] = v;
          else if (s.type === 'choice' && s.options.some(([o]) => o === v)) this.values[s.key] = v;
          else if (s.type === 'text' && typeof v === 'string') this.values[s.key] = v.slice(0, s.max || 200);
        }
      }
    } catch { /* storage unavailable */ }
    // 2.2: the Lyricify background is new and the default; switch once to it
    // (pick another style in Settings to go back).
    try {
      if (!localStorage.getItem('lyricplayer:bgLyricify')) {
        localStorage.setItem('lyricplayer:bgLyricify', '1');
        if (this.values.bgStyle === 'amll') { this.values.bgStyle = 'lyricify'; this.save(); }
      }
    } catch { /* storage unavailable */ }
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.save();
    for (const fn of this.listeners) fn(key, value, this.values);
  }

  reset() {
    for (const [k, v] of Object.entries(DEFAULTS)) this.set(k, v);
  }

  /** fn(key, value, all) on every change; called once now with key = null. */
  subscribe(fn) {
    this.listeners.add(fn);
    fn(null, null, this.values);
    return () => this.listeners.delete(fn);
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.values)); } catch { /* storage unavailable */ }
  }
}
