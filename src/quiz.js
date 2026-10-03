// Lyrics quiz (••• → Lyrics quiz): a word disappears from the next line;
// type it before the line is over.

import { fold } from './lyrics-search.js';

const LEAD = 6;        // s before a line starts that it's shown
const STOP = new Set(['the', 'and', 'you', 'your', 'that', 'with', 'this', 'for', 'are', 'but', 'was', 'its', 'it’s', 'i’m', 'im', 'just', 'like', 'from']);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plain = (w) => fold(w).replace(/[^\p{L}\p{N}]+/gu, '');

/** Words of a line ([{ text, begin }]), timed or not. */
function wordsOf(line) {
  if (line.words?.length) return line.words.map((w) => ({ text: w.text, spaceBefore: w.spaceBefore !== false }));
  return String(line.text || '').split(/\s+/).filter(Boolean).map((t) => ({ text: t, spaceBefore: true }));
}

/** Which word to hide: the longest "real" word (3+ letters, not a filler word). */
export function pickBlank(words, rand = Math.random) {
  const ok = words.map((w, i) => ({ i, p: plain(w.text) })).filter((x) => x.p.length >= 3 && !STOP.has(x.p));
  if (!ok.length || words.length < 3) return -1;
  ok.sort((a, b) => b.p.length - a.p.length);
  const pool = ok.slice(0, Math.min(3, ok.length));
  return pool[Math.floor(rand() * pool.length)].i;
}

export const sameWord = (a, b) => plain(a) === plain(b) && plain(a).length > 0;

export class LyricQuiz {
  /** h: { model(), time(), toast } */
  constructor(h) {
    this.h = h;
    this.el = null;
    this.q = null;   // current question { line, words, blank, answer, state }
    this.score = 0;
    this.asked = 0;
    this.streak = 0;
    this.done = new Set();
  }

  get open() { return !!this.el; }

  toggle() { if (this.el) this.close(); else this.start(); }

  start() {
    const m = this.h.model();
    if (!m || m.timing === 'none' || !m.lines.length) { this.h.toast('The quiz needs synced lyrics'); return; }
    this.score = this.asked = this.streak = 0;
    this.done.clear();
    this.q = null;
    this.el = document.createElement('div');
    this.el.className = 'quiz';
    this.el.innerHTML = `
      <div class="qz-head"><span class="qz-title">Lyrics quiz</span><span class="qz-score" aria-live="polite">0 / 0</span><button class="qz-close" aria-label="End quiz">✕</button></div>
      <div class="qz-line" aria-live="polite">Get ready…</div>
      <form class="qz-form"><input class="qz-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type the missing word" aria-label="Missing word"><button class="pill pill-small">Check</button></form>`;
    document.body.appendChild(this.el);
    document.documentElement.classList.add('quizzing'); // the answers are in the lyrics: blur them
    this.input = this.el.querySelector('.qz-input');
    this.el.querySelector('.qz-close').addEventListener('click', () => this.close());
    this.el.querySelector('.qz-form').addEventListener('submit', (e) => { e.preventDefault(); this.check(true); });
    this.input.addEventListener('input', () => this.check(false));
    this.input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.close(); });
    requestAnimationFrame(() => { this.el?.classList.add('open'); this.input.focus(); });
  }

  close() {
    if (!this.el) return;
    const el = this.el;
    this.el = null;
    document.documentElement.classList.remove('quizzing');
    if (this.asked) this.h.toast(`Quiz over: ${this.score} of ${this.asked} right`);
    el.classList.remove('open');
    setTimeout(() => el.remove(), 250);
  }

  /** Each frame. */
  update(t) {
    if (!this.el) return;
    const m = this.h.model();
    if (!m) return;
    // Finish the current question once its line is over.
    if (this.q && this.q.state === 'asking' && t > this.q.line.end + 0.15) this.reveal(false);
    if (this.q && this.q.state !== 'asking' && t > this.q.shownUntil) this.q = null;
    if (this.q) return;
    // Next line worth asking about, starting within LEAD seconds.
    const line = m.lines.find((l) => l.begin > t - 0.2 && l.begin - t < LEAD && !this.done.has(l) && !l.isBackground);
    if (!line) return;
    this.done.add(line);
    const words = wordsOf(line);
    const blank = pickBlank(words);
    if (blank < 0) return;
    this.q = { line, words, blank, answer: words[blank].text, state: 'asking', shownUntil: 0 };
    this.asked++;
    this.input.value = '';
    this.input.classList.remove('right', 'wrong');
    this.render();
    this.score_();
  }

  render() {
    const q = this.q;
    this.el.querySelector('.qz-line').innerHTML = q.words.map((w, i) => `${i && w.spaceBefore ? ' ' : ''}${i === q.blank
      ? `<span class="qz-blank ${q.state}">${q.state === 'asking' ? '_'.repeat(Math.max(3, plain(w.text).length)) : esc(w.text)}</span>`
      : esc(w.text)}`).join('');
  }

  check(submit) {
    const q = this.q;
    if (!q || q.state !== 'asking') return;
    if (sameWord(this.input.value, q.answer)) this.reveal(true);
    else if (submit) { this.input.classList.add('wrong'); setTimeout(() => this.input.classList.remove('wrong'), 400); }
  }

  reveal(right) {
    const q = this.q;
    q.state = right ? 'right' : 'missed';
    q.shownUntil = Math.max(this.h.time() + 1.5, q.line.end);
    if (right) { this.score++; this.streak++; } else this.streak = 0;
    this.input.classList.toggle('right', right);
    this.render();
    this.score_();
  }

  score_() {
    this.el.querySelector('.qz-score').textContent = `${this.score} / ${this.asked}${this.streak >= 3 ? ` · 🔥 ${this.streak}` : ''}`;
  }
}
