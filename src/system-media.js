// Music playing in another app on this PC (desktop app, Windows): Spotify,
// Apple Music, a browser... The main process reads Windows' media controls
// (desktop/system-media.cjs); this tidies what the apps report and keeps a
// running position so lyrics can follow along.

const APPS = [
  [/spotify/i, 'Spotify'],
  [/applemusic|apple\s*music|itunes/i, 'Apple Music'],
  [/tidal/i, 'TIDAL'],
  [/deezer/i, 'Deezer'],
  [/amazon/i, 'Amazon Music'],
  [/youtube.*music|ytmdesktop/i, 'YouTube Music'],
  [/msedge/i, 'Edge'],
  [/chrome/i, 'Chrome'],
  [/firefox/i, 'Firefox'],
  [/opera/i, 'Opera'],
  [/brave/i, 'Brave'],
  [/vivaldi/i, 'Vivaldi'],
  [/^arc\b|thebrowsercompany/i, 'Arc'],
  [/zunemusic|groove|media\s*player/i, 'Media Player'],
  [/foobar/i, 'foobar2000'],
  [/musicbee/i, 'MusicBee'],
  [/vlc/i, 'VLC'],
];

export function appName(id) {
  const s = String(id || '');
  for (const [re, name] of APPS) if (re.test(s)) return name;
  const base = s.split(/[\\/!]/).filter(Boolean).pop() || s;
  // Store apps and some browsers add an ID: "App_8wekyb3d8bbwe", "Vivaldi.GFF726DREKL…".
  return base.replace(/\.exe$/i, '').replace(/[._][a-z0-9]{10,}$/i, '') || 'another app';
}

const BROWSERS = new Set(['Edge', 'Chrome', 'Firefox', 'Opera', 'Brave', 'Vivaldi', 'Arc']);
// "(Official Video)", "[Lyrics]", "(Audio)", "| Official Music Video"...
const VIDEO_JUNK = /\s*[([【]\s*(official\s*)?(music\s*)?(lyrics?|lyric\s*video|video|audio|visuali[sz]er|mv|m\/v|hd|hq|4k)[^)\]】]*[)\]】]|\s*[|｜]\s*official.*$/gi;

/** Cleans up what an app reported: { title, artist, album }. */
export function normalizeTrack(raw) {
  let title = String(raw.title || '').trim();
  let artist = String(raw.artist || '').trim();
  let album = String(raw.album || '').trim();
  const app = appName(raw.app);
  // Apple Music for Windows reports "Artist — Album" as the artist.
  if (!album && / — /.test(artist)) {
    const i = artist.lastIndexOf(' — ');
    album = artist.slice(i + 3).trim();
    artist = artist.slice(0, i).trim();
  }
  if (BROWSERS.has(app) || /YouTube/.test(app)) {
    title = title.replace(VIDEO_JUNK, '').trim();
    artist = artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    // "Artist - Song" videos: the channel name is often not the artist.
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(title);
    if (m) { artist = m[1].trim(); title = m[2].trim(); }
  }
  return { title, artist, album, app };
}

/** A key that changes when the song changes. */
export const trackKey = (raw) => `${raw.app}|${raw.title}|${raw.artist}|${raw.album}`;

/**
 * The other app's playback, as a clock: position() runs on between updates
 * (apps only report the position now and then).
 */
export class SystemPlayback {
  constructor() {
    this.raw = null;
    this.pausedAt = null;
  }

  update(raw) {
    const wasPlaying = this.playing;
    this.raw = raw;
    if (wasPlaying && !this.playing) this.pausedAt = Date.now();
    if (this.playing) this.pausedAt = null;
  }

  get playing() { return this.raw?.status === 'Playing'; }
  get rate() { return this.raw?.rate > 0 ? this.raw.rate : 1; }
  get duration() { return this.raw?.duration > 0 ? this.raw.duration : NaN; }

  /** Seconds into the song, now. */
  position(now = Date.now()) {
    const r = this.raw;
    if (!r) return 0;
    let p = r.position || 0;
    const since = r.updated > 0 ? r.updated : now;
    // Playing: count on from the last report. Paused: up to the moment it paused
    // (some apps don't send a fresh position when pausing).
    const until = this.playing ? now : this.pausedAt && this.pausedAt > since ? this.pausedAt : since;
    p += Math.max(0, until - since) / 1000 * this.rate;
    return Number.isFinite(this.duration) ? Math.min(p, this.duration) : p;
  }
}
