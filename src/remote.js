// Phone remote page, served by the desktop app on your home network
// (desktop/remote-server.cjs). Shows what's playing and the line being sung,
// and sends play / pause / next / previous / seek back to the player.

const token = new URLSearchParams(location.search).get('t') || '';
const q = (p) => `${p}${p.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
const root = document.getElementById('remote');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="5.5" y="4" width="4.5" height="16" rx="1.4"/><rect x="14" y="4" width="4.5" height="16" rx="1.4"/></svg>',
  next: '<svg viewBox="0 0 34 24"><path d="M3 5.5v13L15.5 12zM17.5 5.5v13L30 12z"/></svg>',
  prev: '<svg viewBox="0 0 34 24"><path d="M31 5.5v13L18.5 12zM16.5 5.5v13L4 12z"/></svg>',
  bar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="15" width="18" height="5" rx="2.5"/><path d="M6 10h12M8 6.5h8"/></svg>',
};

root.innerHTML = `
  <div class="r-bg" id="bg"></div>
  <main class="r-main">
    <div class="r-art"><img id="art" alt=""><div class="r-art-empty" id="artEmpty">♫</div></div>
    <div class="r-meta"><div class="r-title" id="title">Not playing</div><div class="r-artist" id="artist">Lyric Player</div></div>
    <div class="r-lyrics"><div class="r-line" id="line"></div><div class="r-next" id="next"></div></div>
    <div class="r-progress" id="progress"><div class="r-track"><div class="r-fill" id="fill"></div></div></div>
    <div class="r-times"><span id="elapsed">0:00</span><span id="remaining">-0:00</span></div>
    <div class="r-transport">
      <button class="r-btn" data-cmd="prev" aria-label="Previous">${ICON.prev}</button>
      <button class="r-btn r-play" data-cmd="toggle" id="play" aria-label="Play">${ICON.play}</button>
      <button class="r-btn" data-cmd="next" aria-label="Next">${ICON.next}</button>
    </div>
    <div class="r-extra"><button class="r-pill" data-cmd="bar">${ICON.bar}<span>Floating lyrics</span></button></div>
    <div class="r-status" id="status">Connecting…</div>
  </main>`;

const $ = (id) => document.getElementById(id);
let s = null;      // last state from the player
let at = 0;        // when it arrived (performance.now)
let artKey = null;
let lineKey = '';

async function send(cmd, value) {
  if (navigator.vibrate) navigator.vibrate(8);
  try {
    await fetch(q('/api/cmd'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cmd, value }) });
  } catch { $('status').textContent = 'Can’t reach Lyric Player'; }
}

root.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) send(b.dataset.cmd);
});

// Seek by dragging the bar.
const bar = $('progress');
let dragging = false;
const frac = (e) => { const r = bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
bar.addEventListener('pointerdown', (e) => { if (!s?.duration) return; dragging = true; bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); show(frac(e) * s.duration); });
bar.addEventListener('pointermove', (e) => { if (dragging) show(frac(e) * s.duration); });
bar.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false; bar.classList.remove('drag');
  const t = frac(e) * s.duration;
  const off = (s.position || 0) - (s.time || 0); // lyric offset
  s.position = t; s.time = t - off; at = performance.now();
  send('seek', t);
});

function show(pos) {
  const d = s?.duration || 0;
  $('fill').style.width = `${d ? (pos / d) * 100 : 0}%`;
  $('elapsed').textContent = fmt(pos);
  $('remaining').textContent = `-${fmt(d - pos)}`;
}

function apply(next) {
  s = next; at = performance.now();
  $('title').textContent = s.title || 'Not playing';
  $('artist').textContent = s.artist || (s.title ? '' : 'Play something on your PC');
  document.title = s.title ? `${s.title} · Lyric Player` : 'Lyric Player remote';
  $('play').innerHTML = s.playing ? ICON.pause : ICON.play;
  $('play').setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
  if (s.art !== artKey) {
    artKey = s.art;
    $('art').hidden = !s.art; $('artEmpty').hidden = !!s.art;
    if (s.art) { $('art').src = s.art; $('bg').style.backgroundImage = `url("${s.art}")`; } else $('bg').style.backgroundImage = '';
  }
  const key = `${s.line?.begin}|${s.line?.text}`;
  if (key !== lineKey) {
    lineKey = key;
    const words = s.line?.words?.length ? s.line.words : null;
    $('line').innerHTML = words
      ? words.map((w) => `${w.spaceBefore === false ? '' : ' '}<span class="w" data-b="${w.begin}" data-e="${w.end}">${esc(w.text)}</span>`).join('')
      : esc(s.line?.text || s.message || '');
    $('line').classList.remove('in'); void $('line').offsetWidth; $('line').classList.add('in');
  }
  $('next').textContent = s.next || '';
  $('status').textContent = '';
}

function tick() {
  if (s) {
    const dt = s.playing ? (performance.now() - at) / 1000 : 0;
    if (!dragging) show(Math.min(s.duration || 0, (s.position || 0) + dt));
    const t = (s.time || 0) + dt;
    for (const w of $('line').querySelectorAll('.w')) {
      const b = +w.dataset.b, e = +w.dataset.e;
      w.style.setProperty('--p', `${Math.min(1, Math.max(0, (t - b) / Math.max(0.05, e - b))) * 100}%`);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function connect() {
  const es = new EventSource(q('/api/events'));
  es.onmessage = (e) => { try { apply(JSON.parse(e.data)); } catch { /* ignore */ } };
  es.onerror = () => { $('status').textContent = 'Reconnecting…'; };
}
connect();
