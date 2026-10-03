// Last.fm scrobbling (desktop app).
//
// The user makes a free Last.fm API account and pastes its key and secret in
// Settings. Connecting opens Last.fm's own approval page in the browser; the
// session key that comes back is kept in <userData>/lastfm.json (never in the
// page). Requests are signed as Last.fm's API requires (md5 of the sorted
// parameters plus the secret).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const API = 'https://ws.audioscrobbler.com/2.0/';

class LastFm {
  constructor(app, shell) {
    this.shell = shell;
    this.file = path.join(app.getPath('userData'), 'lastfm.json');
    this.session = null; // { key, name, apiKey }
    try { this.session = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* not connected */ }
    this.pending = null;
  }

  save() {
    if (this.session) fs.promises.writeFile(this.file, JSON.stringify(this.session)).catch(() => {});
    else fs.promises.rm(this.file, { force: true }).catch(() => {});
  }

  status(apiKey) {
    const ok = !!this.session && (!apiKey || this.session.apiKey === apiKey);
    return { connected: ok, name: ok ? this.session.name : null, connecting: !!this.pending };
  }

  static sign(params, secret) {
    const base = Object.keys(params).filter((k) => k !== 'format' && k !== 'callback').sort().map((k) => k + params[k]).join('');
    return crypto.createHash('md5').update(base + secret, 'utf8').digest('hex');
  }

  async call(method, params, { apiKey, secret, post = false, signed = true }) {
    const p = { method, api_key: apiKey, ...params };
    if (signed) p.api_sig = LastFm.sign(p, secret);
    p.format = 'json';
    const body = new URLSearchParams(p);
    const r = post
      ? await fetch(API, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'LyricPlayer/1 (by Ruytha)' } })
      : await fetch(`${API}?${body}`, { headers: { 'user-agent': 'LyricPlayer/1 (by Ruytha)' } });
    const data = await r.json().catch(() => ({}));
    if (data.error) {
      const err = new Error(data.message || `Last.fm error ${data.error}`);
      err.code = data.error;
      throw err;
    }
    if (!r.ok) throw new Error(`Last.fm HTTP ${r.status}`);
    return data;
  }

  /** Opens Last.fm's approval page and waits (up to 3 minutes) for the user to allow it. */
  async connect({ apiKey, secret }) {
    if (!/^[0-9a-f]{32}$/i.test(apiKey || '') || !/^[0-9a-f]{32}$/i.test(secret || '')) throw new Error('Paste your Last.fm API key and shared secret first (32 characters each)');
    const keys = { apiKey, secret };
    const { token } = await this.call('auth.getToken', {}, keys);
    await this.shell.openExternal(`https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&token=${encodeURIComponent(token)}`);
    const started = Date.now();
    this.pending = token;
    try {
      while (Date.now() - started < 180000) {
        await new Promise((r) => setTimeout(r, 3000));
        if (this.pending !== token) throw new Error('cancelled');
        try {
          const { session } = await this.call('auth.getSession', { token }, keys);
          this.session = { key: session.key, name: session.name, apiKey };
          this.save();
          return this.status(apiKey);
        } catch (e) {
          if (e.code !== 14) throw e; // 14: not authorised yet
        }
      }
      throw new Error('Timed out waiting for Last.fm approval');
    } finally {
      if (this.pending === token) this.pending = null;
    }
  }

  disconnect() {
    this.pending = null;
    this.session = null;
    this.save();
    return this.status();
  }

  track(t) {
    const p = { artist: String(t.artist || '').slice(0, 300), track: String(t.title || '').slice(0, 300) };
    if (t.album) p.album = String(t.album).slice(0, 300);
    if (t.duration > 0) p.duration = String(Math.round(t.duration));
    return p;
  }

  async nowPlaying(t, keys) {
    if (!this.session || !t.artist || !t.title) return false;
    await this.call('track.updateNowPlaying', { ...this.track(t), sk: this.session.key }, { ...keys, post: true });
    return true;
  }

  async scrobble(t, keys) {
    if (!this.session || !t.artist || !t.title) return false;
    await this.call('track.scrobble', { ...this.track(t), timestamp: String(Math.floor(t.startedAt / 1000)), sk: this.session.key }, { ...keys, post: true });
    return true;
  }
}

module.exports = { LastFm };
