// Last.fm scrobbling rules (desktop app): "now playing" when a song starts,
// a scrobble once it has played for half its length or 4 minutes, whichever
// is first (songs shorter than 30 s are never scrobbled). Listening time is
// counted from real playback, so seeking ahead doesn't count.

export class Scrobbler {
  /** send(kind, track) → Promise; kind: 'now-playing' | 'scrobble' */
  constructor(send) {
    this.send = send;
    this.track = null;
    this.listened = 0;
    this.done = false;
    this.lastPos = null;
  }

  /** Called when a different song starts (track: { title, artist, album, duration }). */
  start(track) {
    this.track = track && track.title && track.artist ? { ...track, startedAt: Date.now() } : null;
    this.listened = 0;
    this.done = false;
    this.lastPos = null;
    if (this.track) this.send('now-playing', this.track).catch(() => {});
  }

  /** Called regularly with the playback position (s). */
  tick(pos, playing) {
    if (!this.track) return;
    if (this.lastPos != null && playing) {
      const d = pos - this.lastPos;
      if (d > 0 && d < 1.5) this.listened += d; // ignore seeks
      // Looped back to the start after scrobbling (repeat one): a new listen.
      if (this.done && pos < 2 && this.lastPos > 10) { this.start({ ...this.track }); return; }
    }
    this.lastPos = pos;
    const dur = this.track.duration || 0;
    if (!this.done && dur >= 30 && this.listened >= Math.min(dur / 2, 240)) {
      this.done = true;
      this.send('scrobble', this.track).catch(() => { this.done = false; });
    }
  }
}
