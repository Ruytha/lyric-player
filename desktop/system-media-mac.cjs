// What's playing on this Mac: Spotify and Apple Music (Music.app), read with
// AppleScript (JavaScript for Automation) once a second. macOS asks once
// whether Lyric Player may control each app. Same messages as the Windows
// helper (system-media.ps1), so the page doesn't care which one it is.

const { execFile } = require('node:child_process');

// Only apps that are already open are asked (Application(id).running() doesn't launch them).
const READ = `
function run() {
  var out = [];
  var apps = [['Spotify', 'com.spotify.client'], ['Apple Music', 'com.apple.Music']];
  for (var i = 0; i < apps.length; i++) {
    var name = apps[i][0], id = apps[i][1];
    try {
      var a = Application(id);
      if (!a.running()) continue;
      var st = String(a.playerState());
      if (st === 'stopped') { out.push({ app: name, status: 'Stopped' }); continue; }
      var t = a.currentTrack;
      var r = { app: name, status: st === 'playing' ? 'Playing' : 'Paused', title: t.name(), artist: t.artist(), album: t.album(), position: a.playerPosition() };
      var d = t.duration();
      r.duration = name === 'Spotify' ? d / 1000 : d;
      if (name === 'Spotify') { try { r.art = t.artworkUrl(); } catch (e) {} }
      out.push(r);
    } catch (e) { out.push({ app: name, error: String(e).slice(0, 200) }); }
  }
  return JSON.stringify(out);
}`;

const ACTIONS = {
  toggle: 'playpause()',
  play: 'play()',
  pause: 'pause()',
  next: 'nextTrack()',
  prev: 'previousTrack()',
};
const IDS = { Spotify: 'com.spotify.client', 'Apple Music': 'com.apple.Music' };

function jxa(code) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-l', 'JavaScript', '-e', code], { timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim())));
  });
}

class MacMedia {
  constructor({ emit, log = () => {} }) {
    this.emit = emit;
    this.log = log;
    this.timer = null;
    this.last = null;      // last state sent
    this.current = null;   // app being followed
    this.lastPlaying = {}; // app -> when it last played
    this.warned = false;
  }

  start() {
    if (this.timer) return;
    const tick = async () => {
      await this.poll().catch((e) => this.log(`[system-media] ${String(e.message || e).slice(0, 200)}`));
      if (this.timer) this.timer = setTimeout(tick, 1000);
    };
    this.timer = setTimeout(tick, 0);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.last = null;
  }

  async poll() {
    const list = JSON.parse((await jxa(READ)) || '[]');
    const now = Date.now();
    for (const r of list) {
      if (r.error && !this.warned) { this.warned = true; this.log(`[system-media] ${r.app}: ${r.error} (allow Lyric Player in System Settings → Privacy & Security → Automation)`); }
      if (r.status === 'Playing') this.lastPlaying[r.app] = now;
    }
    const usable = list.filter((r) => r.title);
    // The one playing; else the one that played last.
    const pick = usable.find((r) => r.status === 'Playing')
      || usable.sort((a, b) => (this.lastPlaying[b.app] || 0) - (this.lastPlaying[a.app] || 0))[0];
    if (!pick) {
      this.current = null;
      if (this.last?.none !== true) { this.last = { none: true }; this.emit({ none: true }); }
      return;
    }
    this.current = pick.app;
    const s = {
      app: pick.app, title: pick.title, artist: pick.artist || '', album: pick.album || '', albumArtist: '',
      status: pick.status, rate: 1, position: Number(pick.position) || 0, duration: Number(pick.duration) || 0, updated: now,
      canSeek: true, canNext: true, canPrev: true,
      track: `${pick.app}|${pick.title}|${pick.artist}|${pick.album}`,
      thumb: typeof pick.art === 'string' && /^https:\/\//.test(pick.art) ? pick.art : null,
    };
    // Only when something changed, or the position drifted from where it should be.
    const l = this.last;
    const expected = l && !l.none ? l.position + (l.status === 'Playing' ? (now - l.updated) / 1000 : 0) : null;
    const same = l && !l.none && l.track === s.track && l.status === s.status && l.thumb === s.thumb && Math.abs(expected - s.position) < 0.35;
    if (same) return;
    this.last = s;
    this.emit(s);
  }

  command(cmd, value) {
    const id = IDS[this.current];
    if (!id) return false;
    let code;
    if (cmd === 'seek') code = `Application('${id}').playerPosition = ${Math.max(0, Number(value) || 0).toFixed(3)}`;
    else if (ACTIONS[cmd]) code = `Application('${id}').${ACTIONS[cmd]}`;
    else return false;
    jxa(code).then(() => this.poll()).catch((e) => this.log(`[system-media] ${cmd}: ${String(e.message || e).slice(0, 200)}`));
    return true;
  }
}

module.exports = { MacMedia };
