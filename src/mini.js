// Mini player window (desktop app). The main window sends the state; this
// window only draws it and sends button presses back.

const native = window.lyricPlayerNative;
const $ = (id) => document.getElementById(id);
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
  $('meta').textContent = [s.title, s.artist].filter(Boolean).join(' — ');
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
