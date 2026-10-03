// Tap-to-sync (••• → Tap to sync lyrics…): paste plain lyrics, play the song
// and tap (or press Space) as each line starts. Makes line-synced TTML.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const ts = (s) => {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};

/** TTML with one <p> per line; each line lasts until the next one starts. */
export function buildLineTtml(lines, times, { title = '', artist = '', duration = 0 } = {}) {
  const n = Math.min(lines.length, times.length);
  const ps = [];
  for (let i = 0; i < n; i++) {
    const begin = times[i];
    const next = i + 1 < n ? times[i + 1] : (duration > begin ? Math.min(duration, begin + 8) : begin + 5);
    const end = Math.max(begin + 0.3, next - 0.05);
    ps.push(`<p begin="${ts(begin)}" end="${ts(end)}">${esc(lines[i])}</p>`);
  }
  const end = n ? Math.max(...ps.map((_, i) => times[i])) + 5 : 0;
  const meta = [title && `<amll:meta key="musicName" value="${esc(title)}"/>`, artist && `<amll:meta key="artists" value="${esc(artist)}"/>`].filter(Boolean).join('');
  return `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:amll="http://www.example.com/ns/amll" itunes:timing="Line" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata>${meta}</metadata></head><body dur="${ts(duration || end)}"><div>${ps.join('')}</div></body></tt>`;
}

export class TapSync {
  /** h: { position(), playing(), seek(t), play(), pause(), song(), duration(), initialText(), onDone(ttml), toast } */
  constructor(h) {
    this.h = h;
    this.root = null;
  }

  open() {
    this.close();
    const root = this.root = document.createElement('div');
    root.className = 'lyric-search whats-new tapsync';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Tap to sync');
    root.innerHTML = `
      <div class="ls-panel wn-panel ts-panel">
        <div class="card-head">
          <h2>Tap to sync</h2>
          <button class="sheet-btn sheet-close" data-close type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="wn-body ts-step ts-paste">
          <p class="ts-hint">Paste the lyrics, one line per line. Then play the song and tap as each line starts.</p>
          <textarea class="ts-text" spellcheck="false" placeholder="First line of the song&#10;Second line…"></textarea>
        </div>
        <div class="wn-body ts-step ts-tap" hidden>
          <div class="ts-prev"></div>
          <div class="ts-cur"></div>
          <div class="ts-next"></div>
          <button class="ts-big" type="button">Tap when this line starts</button>
          <p class="ts-hint">Space or tap: next line · Backspace: undo · the song restarts from 3 s before an undone line</p>
          <div class="ts-count"></div>
        </div>
        <div class="acct-buttons wn-foot">
          <button class="pill pill-small ts-back" type="button" hidden>Edit text</button>
          <button class="pill pill-small ts-start" type="button">Start from the beginning</button>
          <button class="pill pill-small ts-finish" type="button" hidden>Finish</button>
        </div>
      </div>`;
    document.body.appendChild(root);
    const text = root.querySelector('.ts-text');
    text.value = this.h.initialText() || '';
    root.querySelector('.ts-start').addEventListener('click', () => this.begin());
    root.querySelector('.ts-back').addEventListener('click', () => this.showStep('paste'));
    root.querySelector('.ts-finish').addEventListener('click', () => this.finish());
    root.querySelector('.ts-big').addEventListener('click', () => this.tap());
    for (const b of root.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { this.close(); return; }
      if (this.step !== 'tap') return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.tap(); }
      else if (e.key === 'Backspace') { e.preventDefault(); this.undo(); }
    });
    this.showStep('paste');
    requestAnimationFrame(() => { root.classList.add('open'); text.focus(); });
  }

  showStep(step) {
    this.step = step;
    const r = this.root;
    r.querySelector('.ts-paste').hidden = step !== 'paste';
    r.querySelector('.ts-tap').hidden = step !== 'tap';
    r.querySelector('.ts-start').hidden = step !== 'paste';
    r.querySelector('.ts-back').hidden = step !== 'tap';
    r.querySelector('.ts-finish').hidden = step !== 'tap';
    if (step === 'tap') r.querySelector('.ts-big').focus();
  }

  begin() {
    this.lines = this.root.querySelector('.ts-text').value.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!this.lines.length) { this.h.toast('Paste the lyrics first'); return; }
    this.times = [];
    this.showStep('tap');
    this.h.seek(0);
    this.h.play();
    this.render();
  }

  tap() {
    if (this.times.length >= this.lines.length) { this.finish(); return; }
    const t = this.h.position();
    if (this.times.length && t <= this.times.at(-1)) return;
    this.times.push(t);
    this.render();
    if (this.times.length === this.lines.length) this.root.querySelector('.ts-big').textContent = 'All lines done: Finish';
  }

  undo() {
    if (!this.times.length) return;
    this.times.pop();
    this.h.seek(Math.max(0, (this.times.at(-1) ?? 3) - 3));
    this.root.querySelector('.ts-big').textContent = 'Tap when this line starts';
    this.render();
  }

  render() {
    const i = this.times.length;
    const r = this.root;
    r.querySelector('.ts-prev').textContent = this.lines[i - 1] || '';
    r.querySelector('.ts-cur').textContent = this.lines[i] || '✓ Every line has a time';
    r.querySelector('.ts-next').textContent = this.lines[i + 1] || '';
    r.querySelector('.ts-count').textContent = `${i} of ${this.lines.length} lines`;
  }

  finish() {
    if (!this.times.length) { this.h.toast('Tap at least one line first'); return; }
    const song = this.h.song();
    const ttml = buildLineTtml(this.lines.slice(0, this.times.length), this.times, { ...song, duration: this.h.duration() });
    if (this.times.length < this.lines.length) this.h.toast(`Saved the first ${this.times.length} lines`);
    this.close();
    this.h.onDone(ttml);
  }

  close() {
    const r = this.root;
    if (!r) return;
    this.root = null;
    r.classList.remove('open');
    setTimeout(() => r.remove(), 250);
  }
}
