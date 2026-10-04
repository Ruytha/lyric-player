// Your listening stats ("Wrapped"), kept on this device only: every song you
// listen to for 30 seconds or more is noted with how long you listened.

const KEY = 'lyricplayer:plays';
const MAX = 20000;
const MIN_SECS = 30;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function readPlays(storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(KEY)) || []; } catch { return []; }
}

/** Counts listening time per song; call tick() every second. */
export class PlayLog {
  constructor({ storage = globalThis.localStorage } = {}) {
    this.storage = storage;
    this.cur = null; // { title, artist, album, at, secs }
  }

  tick(song, playing) {
    const key = song?.title ? `${song.title}|${song.artist || ''}` : null;
    if (this.cur && this.cur.key !== key) this.flush();
    if (!key) return;
    if (!this.cur) this.cur = { key, t: song.title, a: song.artist || '', al: song.album || '', at: Date.now(), s: 0 };
    if (playing) this.cur.s += 1;
  }

  /** Song over (or switched): note it if it was listened to long enough. */
  flush() {
    const c = this.cur;
    this.cur = null;
    if (!c || c.s < MIN_SECS) return;
    try {
      const plays = readPlays(this.storage);
      plays.push({ t: c.t, a: c.a, al: c.al, at: c.at, s: c.s });
      this.storage.setItem(KEY, JSON.stringify(plays.slice(-MAX)));
    } catch { /* storage full */ }
  }
}

const DAY = 86400000;

/** Totals for plays since `from` (ms). */
export function summarize(plays, from = 0, now = Date.now()) {
  const list = plays.filter((p) => p.at >= from && p.at <= now);
  const songs = new Map(), artists = new Map(), hours = new Array(24).fill(0), days = new Set();
  let secs = 0;
  for (const p of list) {
    secs += p.s;
    const k = `${p.t}|${p.a}`;
    const s = songs.get(k) || { title: p.t, artist: p.a, plays: 0, secs: 0 };
    s.plays++; s.secs += p.s; songs.set(k, s);
    for (const name of (p.a || 'Unknown artist').split(/\s*(?:,|&| feat\.? | ft\.? | x )\s*/i).filter(Boolean)) {
      const a = artists.get(name) || { name, plays: 0, secs: 0 };
      a.plays++; a.secs += p.s; artists.set(name, a);
    }
    const d = new Date(p.at);
    hours[d.getHours()] += p.s;
    days.add(d.toDateString());
  }
  const by = (a, b) => b.secs - a.secs || b.plays - a.plays;
  const byPlays = (a, b) => b.plays - a.plays || b.secs - a.secs;
  // Longest run of days in a row with music.
  let streak = 0, run = 0, prev = null;
  for (const d of [...days].map((x) => new Date(x).getTime()).sort((a, b) => a - b)) {
    run = prev != null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1;
    streak = Math.max(streak, run);
    prev = d;
  }
  const peak = hours.indexOf(Math.max(...hours));
  return {
    plays: list.length, minutes: Math.round(secs / 60), songs: [...songs.values()].sort(byPlays), artists: [...artists.values()].sort(by),
    uniqueSongs: songs.size, days: days.size, streak, peakHour: list.length ? peak : null,
  };
}

const PERIODS = [
  ['week', 'This week', () => Date.now() - 7 * DAY],
  ['month', 'This month', () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }],
  ['year', 'This year', () => new Date(new Date().getFullYear(), 0, 1).getTime()],
  ['all', 'All time', () => 0],
];

const hourName = (h) => (h == null ? 'Not yet' : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' }));
const timeOfDay = (h) => (h == null ? '' : h < 5 ? 'a night owl' : h < 12 ? 'a morning person' : h < 17 ? 'an afternoon listener' : h < 21 ? 'an evening listener' : 'a night owl');

/** The stats dialog. */
export function showStats({ log } = {}) {
  log?.flush?.();
  document.getElementById('statsDialog')?.remove();
  const root = document.createElement('div');
  root.className = 'lyric-search whats-new stats';
  root.id = 'statsDialog';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Your stats');
  root.innerHTML = `
    <div class="ls-panel wn-panel st-panel">
      <div class="card-head">
        <h2>Your stats</h2>
        <button class="sheet-btn sheet-close" data-close type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="st-periods" role="tablist">${PERIODS.map(([k, label]) => `<button class="st-chip" data-period="${k}" role="tab">${label}</button>`).join('')}</div>
      <div class="wn-body st-body"></div>
      <div class="acct-buttons wn-foot"><span class="st-note">Kept on this device only</span><button class="pill pill-small" data-close type="button">Done</button></div>
    </div>`;
  document.body.appendChild(root);
  const plays = readPlays();
  const render = (period) => {
    for (const c of root.querySelectorAll('.st-chip')) c.setAttribute('aria-selected', String(c.dataset.period === period));
    const s = summarize(plays, PERIODS.find((p) => p[0] === period)[2]());
    const body = root.querySelector('.st-body');
    if (!s.plays) { body.innerHTML = '<p class="st-empty">Nothing yet. Songs you listen to for 30 seconds or more show up here.</p>'; return; }
    const top = s.songs[0];
    body.innerHTML = `
      <div class="st-hero">
        <div class="st-big"><b>${s.minutes.toLocaleString()}</b><span>minutes listened</span></div>
        <div class="st-big"><b>${s.plays.toLocaleString()}</b><span>plays · ${s.uniqueSongs.toLocaleString()} songs</span></div>
      </div>
      <div class="st-song">
        <div class="st-kicker">Your top song</div>
        <div class="st-song-title">${esc(top.title)}</div>
        <div class="st-song-sub">${esc(top.artist)} · played ${top.plays} time${top.plays === 1 ? '' : 's'}</div>
      </div>
      <div class="st-cols">
        <section><h3>Top songs</h3><ol>${s.songs.slice(0, 5).map((x) => `<li><span>${esc(x.title)}</span><small>${esc(x.artist)} · ${x.plays}×</small></li>`).join('')}</ol></section>
        <section><h3>Top artists</h3><ol>${s.artists.slice(0, 5).map((x) => `<li><span>${esc(x.name)}</span><small>${Math.round(x.secs / 60)} min</small></li>`).join('')}</ol></section>
      </div>
      <div class="st-facts">
        <div><b>${hourName(s.peakHour)}</b><span>You listen most around then: ${timeOfDay(s.peakHour)}</span></div>
        <div><b>${s.streak} day${s.streak === 1 ? '' : 's'}</b><span>Longest streak of days with music</span></div>
        <div><b>${s.days}</b><span>Day${s.days === 1 ? '' : 's'} with music</span></div>
      </div>`;
  };
  root.querySelector('.st-periods').addEventListener('click', (e) => { const c = e.target.closest('[data-period]'); if (c) render(c.dataset.period); });
  render('month');
  const close = () => { root.classList.remove('open'); setTimeout(() => root.remove(), 250); };
  for (const b of root.querySelectorAll('[data-close]')) b.addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  requestAnimationFrame(() => { root.classList.add('open'); root.querySelector('.pill[data-close]').focus(); });
}
