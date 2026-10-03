// Mini player window (desktop app). The main window sends the state; this
// window only draws it and sends button presses back.
//
// mini.html?bar is the floating lyrics bar: only the line being sung, over
// other windows. Locked, clicks pass through it (the app ignores the mouse
// except over the handle that appears on hover); unlocked, it can be moved
// and resized.

const native = window.lyricPlayerNative;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const BAR = params.has('bar');
if (params.has('glass')) document.body.classList.add('native-glass');
if (BAR) {
  document.body.classList.add('bar');
  // The bar uses its own line elements; the rest of this file draws into them.
  $('line').id = 'miniLine'; $('next').id = 'miniNext';
  $('barLine').id = 'line'; $('barNext').id = 'next';
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

let state = null;      // last state from the main window
let received = 0;      // performance.now() when it arrived
let lineKey = null;
let spans = [];

native?.onMiniState((s) => {
  state = s;
  received = performance.now();
  if (s.art !== $('art').dataset.src) {
    $('art').dataset.src = s.art || '';
    const v = s.art ? `url("${s.art}")` : 'none';
    $('art').style.backgroundImage = v;
    $('bg').style.backgroundImage = v;
  }
  $('meta').textContent = [s.title, s.artist, s.credit].filter(Boolean).join(' — ');
  const credit = document.getElementById('barCredit');
  if (credit) credit.textContent = s.credit || '';
  $('next').textContent = s.next || '';
  $('playBtn').innerHTML = s.playing
    ? '<svg viewBox="0 0 24 24"><path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
  const key = s.line ? `${s.line.begin}|${s.line.text}` : '';
  if (key !== lineKey) {
    lineKey = key;
    const words = s.line?.words?.length ? s.line.words : s.line ? [{ text: s.line.text, begin: s.line.begin, end: s.line.end }] : [];
    $('line').innerHTML = words.map((w, i) => `${i && w.spaceBefore !== false ? ' ' : ''}<span class="w">${esc(w.text)}</span>`).join('') || (s.message ? esc(s.message) : '♪');
    spans = [...$('line').querySelectorAll('.w')].map((el, i) => ({ el, w: words[i] }));
  }
});

for (const b of document.querySelectorAll('[data-cmd]')) {
  b.addEventListener('click', () => native?.mini('command', { cmd: b.dataset.cmd }));
}

function frame() {
  if (state) {
    const t = state.time + (state.playing ? (performance.now() - received) / 1000 : 0);
    for (const { el, w } of spans) {
      const p = w.end > w.begin ? Math.min(1, Math.max(0, (t - w.begin) / (w.end - w.begin))) : t >= w.begin ? 1 : 0;
      el.classList.toggle('done', p >= 1);
      el.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
    }
    if (state.duration > 0) $('progress').style.width = `${Math.min(100, (state.position + (state.playing ? (performance.now() - received) / 1000 : 0)) / state.duration * 100)}%`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------------------
// Floating lyrics bar

if (BAR) {
  let locked = params.get('locked') !== '0';
  let size = Number(params.get('size')) || 34;
  let overHandle = false;
  let hoverTimer = 0;
  const applySize = () => document.body.style.setProperty('--bar-size', `${size}px`);
  const setLocked = (on) => {
    locked = on;
    document.body.classList.toggle('unlocked', !on);
    native?.mini('bar', { locked: on, size });
    if (on) { overHandle = false; native?.mini('bar', { ignore: true }); }
  };
  applySize();
  document.body.classList.toggle('unlocked', !locked);
  // Locked: the window still gets mouse moves (forwarded), so the handle can
  // show, and the mouse is caught only while it's over the handle.
  addEventListener('mousemove', (e) => {
    document.body.classList.add('hover');
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => document.body.classList.remove('hover'), 1600);
    if (!locked) return;
    const over = !!e.target.closest?.('#barHandle');
    if (over !== overHandle) { overHandle = over; native?.mini('bar', { ignore: !over }); }
  });
  document.addEventListener('mouseleave', () => {
    document.body.classList.remove('hover');
    if (locked && overHandle) { overHandle = false; native?.mini('bar', { ignore: true }); }
  });
  for (const b of document.querySelectorAll('[data-bar]')) {
    b.addEventListener('click', () => {
      if (b.dataset.bar === 'lock') setLocked(!locked);
      else {
        size = Math.min(72, Math.max(18, size + (b.dataset.bar === 'bigger' ? 4 : -4)));
        applySize();
        native?.mini('bar', { size });
      }
    });
  }
}
