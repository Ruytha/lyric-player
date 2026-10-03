// Builds the lyric DOM once per song, then per frame only writes transforms,
// mask positions, text-shadows and classes.
//
// Motion model (tuned against AMLL, the renderer used by AMLL Tool):
// - Text is white; an alpha mask on each word dims it. One soft "front" sweeps
//   the whole line continuously, so the feathered edge carries across word
//   gaps instead of restarting inside every word.
// - Sung words rise 0.05em; held words get a per-letter swell + glow wave.
// - Each line has its own Y spring. When the focus moves, lines start moving
//   top-to-bottom in a 50 ms cascade. Spring stiffness follows the tempo.

import { Spring } from './spring.js';

const ALIGN_RATIO = 0.35;       // focus line's centre sits 35% down the panel
const GAP_EM = 1.0;             // space between lines (line pitch ≈ 2.2em)
const LOOKAHEAD = 0.1;          // start scrolling slightly before a line begins (s)
const FADE_EM = 0.6;            // width of the sweep's soft edge
const RISE_EM = 0.05;           // sung words rise by this much (background vocals 2×)
const BLUR_MAX = 5;             // px
const STAGGER = 0.05;           // s between neighbouring lines in the scroll wave
const STAGGER_DECAY = 1.05;     // the wave speeds up below the focus line
const RESUME_DELAY = 3000;      // ms after manual scroll before auto-follow resumes

// Scroll springs: snappier when lines come quickly, softer after seeks/interludes.
const SPRING_SOFT = { stiffness: 90, damping: 15, mass: 0.9 };
// Line scale: a soft, slightly bouncy spring that follows the same cascade.
const SCALE_SPRING = { stiffness: 100, damping: 25, mass: 2, precision: 0.0005 };
const SCALE_INACTIVE = 0.97;
// Manual scrolling
const WHEEL_SPRING = { stiffness: 260, damping: 40, mass: 1 };
const DECELERATION = 0.998;     // per ms, like iOS scroll views
const RUBBER = 0.55;
function tempoSpring(intervalMs) {
  if (intervalMs == null) return SPRING_SOFT;
  const iv = Math.min(800, Math.max(100, intervalMs));
  const ratio = (1 - (iv - 100) / 700) ** 0.2;
  const stiffness = 170 + ratio * 50;
  return { stiffness, damping: Math.sqrt(stiffness) * 2.2, mass: 0.9 };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutCubic = (x) => 1 - (1 - x) ** 3;
const easeInCubic = (x) => x * x * x;
const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, k) => a + (b - a) * k;

/** CSS-style cubic-bezier(x1, y1, x2, y2) easing. */
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u) => ((ax * u + bx) * u + cx) * u;
  const sy = (u) => ((ay * u + by) * u + cy) * u;
  const dx = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 6; i++) {
      const d = dx(u), e = sx(u) - x;
      if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break;
      u -= e / d;
    }
    if (!(u >= 0 && u <= 1) || Math.abs(sx(u) - x) > 1e-5) {
      let lo = 0, hi = 1;
      u = x;
      for (let i = 0; i < 30 && Math.abs(sx(u) - x) > 1e-6; i++) {
        if (sx(u) < x) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return sy(u);
  };
}
const cssEaseOut = cubicBezier(0, 0, 0.58, 1);
// Held-word swell, as in AMLL: ease up to full at the midpoint, ease back down.
const swellIn = cubicBezier(0.2, 0.4, 0.58, 1);
const swellOut = cubicBezier(0.3, 0, 0.58, 1);

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s));

/** Held words (≥ 1 s) get emphasis; latin words only if short (2–7 letters). */
function shouldEmphasize(w) {
  if (w.end - w.begin < 1) return false;
  const text = w.text.trim();
  if (CJK.test(text)) return true;
  const n = graphemes(text).length;
  return n > 1 && n <= 7;
}

/** Strength of the emphasis effect grows with how long the word is held. */
function emphasisParams(dur, isLast) {
  const shape = (x) => (x > 1 ? Math.sqrt(x) : x ** 3);
  let du = Math.max(1, dur);
  let amount = shape(du / 2) * 0.6;
  let glow = shape(du / 3) * 0.5;
  if (isLast) { amount *= 1.6; glow *= 1.5; du *= 1.2; }
  return { du, amount: Math.min(1.2, amount), glow: Math.min(0.8, glow) };
}

/** 0 → 1 at the midpoint → 0; zero outside 0..1. */
function swellEnvelope(x) {
  if (x <= 0 || x >= 1) return 0;
  return x < 0.5 ? swellIn(x / 0.5) : 1 - swellOut((x - 0.5) / 0.5);
}

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

export class LyricsRenderer {
  constructor(panel, { onSeek } = {}) {
    this.panel = panel;
    this.onSeek = onSeek;
    this.scroller = panel.querySelector('.lyrics-scroller');
    this.emptyEl = panel.querySelector('.lyrics-empty');
    this.items = [];
    this.lineItems = [];
    this.model = null;
    this.anchor = -1;        // item driving blur/active styling
    this.layoutAnchor = -1;  // item the layout is currently aligned on
    this.needsLayout = false;
    this.layoutDirty = false;
    this.fontPx = 52;
    this.gap = 42;
    this.panelH = 0;
    this.hot = new Set();
    this.manual = false;
    this.lastInteraction = 0;
    this.offset = new Spring({ ...SPRING_SOFT, precision: 0.1 });
    this.scroll = { mode: 'idle', v: 0, samples: [] }; // idle | drag | inertia | spring
    this.offsetWritten = null;
    this.static = false;
    this.lastT = 0;

    new ResizeObserver(() => { this.needsLayout = true; }).observe(panel);
    document.fonts?.ready.then(() => { this.needsLayout = true; });
    document.fonts?.addEventListener?.('loadingdone', () => { this.needsLayout = true; });
    this.bindInteraction();
  }

  // -------------------------------------------------------------------------
  // Build

  setLyrics(model, emptyMessage) {
    this.scroller.textContent = '';
    this.items = [];
    this.lineItems = [];
    this.hot.clear();
    this.model = model && model.lines.length ? model : null;
    this.anchor = this.layoutAnchor = -1;
    this.manual = false;
    this.offset.jump(0);
    this.scroll.mode = 'idle';
    this.panel.classList.remove('manual');

    if (!this.model) {
      this.emptyEl.textContent = emptyMessage || (model ? 'This TTML file has no lyric lines.' : '');
      this.emptyEl.hidden = !this.emptyEl.textContent;
      this.panel.classList.remove('static', 'has-duet');
      return;
    }
    this.emptyEl.hidden = true;
    this.static = model.timing === 'none';
    this.panel.classList.toggle('static', this.static);
    this.panel.classList.toggle('has-duet', model.lines.some((l) => l.isDuet));

    const interludesBefore = new Map(model.interludes.map((i) => [i.beforeLine, i]));
    const frag = document.createDocumentFragment();
    model.lines.forEach((line, li) => {
      const il = interludesBefore.get(li);
      if (il) this.items.push(this.buildInterlude(il, line));
      const item = this.buildLine(line);
      this.items.push(item);
      this.lineItems.push(item);
    });
    this.items.forEach((it, i) => { it.idx = i; it.el.dataset.idx = i; frag.appendChild(it.el); });
    this.scroller.appendChild(frag);
    this.scroller.classList.remove('enter');
    void this.scroller.offsetWidth; // restart the fade-in
    this.scroller.classList.add('enter');
    this.needsLayout = true;
  }

  /** Words of one line (main or background) plus the state its sweep needs. */
  buildSweep(container, words, mode, isBg) {
    const sweep = { words: [], syls: [], mode, isBg, fontPx: 0, fade: 0, total: 0, lastFront: NaN };
    words.forEach((w, wi) => {
      if (wi > 0 && w.spaceBefore !== false) container.appendChild(document.createTextNode(' '));
      const emphasis = mode === 'word' && shouldEmphasize(w);
      const wEl = h('span', emphasis ? 'word emphasis' : 'word');
      const state = {
        el: wEl, begin: w.begin, end: w.end, emphasis, pad: 0, box: 0, width: 0, offset: 0,
        letters: [], lastMask: NaN, lastRise: NaN, riseP: 0, riseDur: Math.max(1, w.end - w.begin),
        emph: emphasis ? emphasisParams(w.end - w.begin, wi === words.length - 1) : null,
      };
      for (const s of w.syllables) {
        const sEl = h('span', 'syl');
        if (emphasis) {
          for (const ch of graphemes(s.text)) {
            const lEl = h('span', 'letter', ch);
            sEl.appendChild(lEl);
            state.letters.push({ el: lEl, last: '' });
          }
        } else {
          sEl.textContent = s.text;
        }
        wEl.appendChild(sEl);
        sweep.syls.push({ el: sEl, word: state, begin: s.begin, end: s.end, a: 0, w: 0 });
      }
      container.appendChild(wEl);
      sweep.words.push(state);
    });
    return sweep;
  }

  buildLine(line) {
    const el = h('div', `lyric-item line mode-${line.mode}`);
    if (line.isDuet) el.classList.add('duet');
    const inner = h('div', 'line-inner');
    const main = h('div', 'line-main');
    const item = {
      type: 'line', line, el, inner, spring: new Spring({ ...SPRING_SOFT }), h: 0, hOpen: 0,
      scale: new Spring({ ...SCALE_SPRING, value: SCALE_INACTIVE }), scaleWritten: null, scaling: false, delay: 0,
      main: this.buildSweep(main, line.words, line.mode, false), bg: null,
      active: false, mainOn: false, bgOn: false, bgOpen: false,
      blur: -1, moving: false, culled: false, written: null, settling: false,
    };
    inner.appendChild(main);
    if (line.background) {
      const bg = h('div', 'line-bg');
      item.bg = this.buildSweep(bg, line.background.words, line.background.mode, true);
      inner.appendChild(bg);
    }
    if (line.translation) inner.appendChild(h('div', 'line-trans', line.translation));
    el.appendChild(inner);
    return item;
  }

  buildInterlude(data, nextLine) {
    const el = h('div', 'lyric-item interlude');
    if (nextLine.isDuet) el.classList.add('duet');
    const dotsEl = h('div', 'interlude-dots');
    const dots = [0, 1, 2].map(() => { const d = h('span', 'dot'); dotsEl.appendChild(d); return d; });
    el.appendChild(dotsEl);
    return {
      type: 'interlude', data, el, dotsEl, dots, spring: new Spring({ ...SPRING_SOFT }), h: 0, delay: 0,
      visible: false, shown: 0, blur: -1, moving: false, culled: false, written: null, lastDots: '',
    };
  }

  setTranslationVisible(on) {
    this.panel.classList.toggle('show-trans', on);
    this.needsLayout = true;
  }

  // -------------------------------------------------------------------------
  // Layout

  relayout() {
    this.needsLayout = false;
    if (!this.items.length) return;
    this.panelH = this.panel.clientHeight;
    this.fontPx = parseFloat(getComputedStyle(this.scroller).fontSize) || 52;
    this.gap = this.fontPx * GAP_EM;

    // Heights with background vocals expanded and collapsed.
    const sc = this.scroller.classList;
    sc.add('measure-open');
    for (const it of this.items) it.hOpen = it.el.offsetHeight;
    sc.replace('measure-open', 'measure-closed');
    for (const it of this.items) it.h = it.el.offsetHeight;
    sc.remove('measure-closed');

    for (const it of this.lineItems) {
      this.measureSweep(it.main);
      if (it.bg) this.measureSweep(it.bg);
    }
    this.applyLayout(this.layoutAnchor < 0 ? Math.max(0, this.anchor) : this.layoutAnchor, 'instant');
  }

  /** Lay the line's words end to end (ignoring wraps and spaces) for the sweep. */
  measureSweep(sweep) {
    if (!sweep.words.length) return;
    sweep.fontPx = parseFloat(getComputedStyle(sweep.words[0].el).fontSize) || this.fontPx;
    sweep.fade = sweep.fontPx * FADE_EM;
    let x = 0;
    for (const w of sweep.words) {
      w.box = w.el.offsetWidth;
      w.pad = w.el.firstChild ? w.el.firstChild.offsetLeft : 0;
      w.width = Math.max(0, w.box - 2 * w.pad);
      w.offset = x;
      x += w.width;
      w.lastMask = NaN;
    }
    sweep.total = x;
    for (const s of sweep.syls) {
      s.a = s.word.offset + (s.el.offsetLeft - s.word.pad);
      s.w = s.el.offsetWidth;
    }
    sweep.lastFront = NaN;
    if (sweep.mode !== 'word') this.paintSweep(sweep, Infinity);
  }

  itemHeight(it, anchorIdx) {
    if (it.type === 'interlude') return it.idx === anchorIdx ? it.h : 0;
    return it.bgOpen ? it.hOpen : it.h;
  }

  computeTargets(anchorIdx) {
    const items = this.items;
    const ys = new Array(items.length);
    const size = (i) => {
      const hh = this.itemHeight(items[i], anchorIdx);
      return hh ? hh + this.gap : 0;
    };
    ys[anchorIdx] = this.panelH * ALIGN_RATIO - this.itemHeight(items[anchorIdx], anchorIdx) / 2;
    for (let i = anchorIdx + 1; i < items.length; i++) ys[i] = ys[i - 1] + size(i - 1);
    for (let i = anchorIdx - 1; i >= 0; i--) ys[i] = ys[i + 1] - size(i);
    return ys;
  }

  /**
   * mode: 'tick'    – normal playback: tempo spring + top-to-bottom cascade
   *       'seek'    – soft spring, everything moves together
   *       'reflow'  – heights changed: retarget with current springs, no cascade
   *       'instant' – snap
   */
  applyLayout(anchorIdx, mode = 'tick') {
    if (anchorIdx < 0 || !this.items.length) return;
    this.layoutAnchor = anchorIdx;
    this.layoutThisFrame = true;
    const ys = this.computeTargets(anchorIdx);
    this.targets = ys;

    let params = null;
    if (mode === 'seek') params = SPRING_SOFT;
    else if (mode === 'tick') {
      const it = this.items[anchorIdx];
      const prev = this.lineItems[this.lineItems.indexOf(it) - 1];
      params = it.type === 'line' && prev && it.line.begin != null && prev.line.begin != null
        ? tempoSpring((it.line.begin - prev.line.begin) * 1000)
        : SPRING_SOFT;
    }

    let delay = 0, step = STAGGER;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const sp = it.spring;
      it.delay = mode === 'tick' ? delay : 0;
      if (mode === 'instant') { sp.jump(ys[i]); continue; }
      if (params) sp.setParams(params);
      sp.setTarget(ys[i], it.delay);
      // The wave only advances across lines that are actually on screen.
      const top = Math.min(ys[i], sp.value);
      const hh = this.itemHeight(it, anchorIdx);
      if (mode === 'tick' && hh > 0 && top + hh >= 0 && top <= this.panelH) {
        delay += step;
        if (i >= anchorIdx) step /= STAGGER_DECAY;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Interaction: hover (CSS), click-to-seek, manual scroll

  bindInteraction() {
    const panel = this.panel;
    let drag = null;
    let suppressClick = false;

    // Wheel / trackpad: glide to an accumulated target instead of jumping.
    panel.addEventListener('wheel', (e) => {
      if (!this.items.length) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? this.panelH : 1;
      this.enterManual();
      const sc = this.scroll;
      const base = sc.mode === 'spring' ? this.offset.target : this.offset.value;
      const velocity = sc.mode === 'inertia' ? sc.v : this.offset.velocity;
      this.springTo(this.clampOffset(base - e.deltaY * k), velocity);
    }, { passive: false });

    // Drag: follow the pointer 1:1 (rubber-banding past the ends), then fling.
    panel.addEventListener('pointerdown', (e) => {
      if (!this.items.length || e.button !== 0) return;
      if (this.scroll.mode === 'inertia' || this.scroll.mode === 'spring') {
        // Catch a moving list where it is.
        this.offset.jump(this.offset.value);
        this.scroll.mode = 'idle';
      }
      drag = { id: e.pointerId, y: e.clientY, start: this.offset.value, active: false };
    });
    panel.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.active && Math.abs(e.clientY - drag.y) > 6) {
        drag.active = true;
        drag.y = e.clientY;
        try { panel.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        panel.classList.add('dragging');
        this.scroll.mode = 'drag';
        this.scroll.samples = [];
      }
      if (!drag.active) return;
      this.enterManual();
      this.offset.jump(this.rubberBand(drag.start + (e.clientY - drag.y)));
      const now = performance.now();
      const smp = this.scroll.samples;
      smp.push({ t: now, y: e.clientY });
      while (smp.length > 2 && now - smp[0].t > 100) smp.shift();
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.active) {
        suppressClick = true;
        const smp = this.scroll.samples;
        const first = smp[0], last = smp[smp.length - 1];
        const fresh = last && performance.now() - last.t < 60;
        const v = fresh && last.t > first.t ? ((last.y - first.y) / (last.t - first.t)) * 1000 : 0;
        this.release(e.type === 'pointercancel' ? 0 : v);
      }
      drag = null;
      panel.classList.remove('dragging');
    };
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);

    panel.addEventListener('click', (e) => {
      if (suppressClick) { suppressClick = false; return; }
      const el = e.target.closest('.lyric-item.line');
      if (!el) return;
      const item = this.items[+el.dataset.idx];
      if (item?.line.begin != null) this.onSeek?.(item.line.begin);
    });
  }

  enterManual() {
    this.lastInteraction = performance.now();
    if (this.manual) return;
    this.manual = true;
    this.panel.classList.add('manual');
  }

  offsetBounds() {
    if (!this.targets) return [-Infinity, Infinity];
    const focusY = this.panelH * ALIGN_RATIO;
    const last = this.items.length - 1;
    return [focusY - this.targets[last] - this.items[last].h, focusY - this.targets[0]];
  }

  clampOffset(v) {
    const [min, max] = this.offsetBounds();
    return Math.min(max, Math.max(min, v));
  }

  /** iOS-style resistance past either end. */
  rubberBand(v) {
    const [min, max] = this.offsetBounds();
    const d = this.panelH || 600;
    const band = (x) => (1 - 1 / ((x * RUBBER) / d + 1)) * d;
    if (v > max) return max + band(v - max);
    if (v < min) return min - band(min - v);
    return v;
  }

  /** Pointer released with velocity v (px/s): coast, or spring back if past an end. */
  release(v) {
    const clamped = this.clampOffset(this.offset.value);
    if (clamped !== this.offset.value) this.springTo(clamped, v);
    else if (Math.abs(v) > 50) { this.scroll.mode = 'inertia'; this.scroll.v = v; }
    else this.scroll.mode = 'idle';
    this.lastInteraction = performance.now();
  }

  springTo(target, velocity = 0, params = WHEEL_SPRING) {
    this.scroll.mode = 'spring';
    this.offset.setParams(params);
    this.offset.velocity = velocity;
    this.offset.retarget(target);
  }

  stepScroll(dt) {
    const sc = this.scroll;
    if (sc.mode === 'inertia') {
      sc.v *= DECELERATION ** (dt * 1000);
      const next = this.offset.value + sc.v * dt;
      const clamped = this.clampOffset(next);
      this.offset.jump(next);
      // Ran off an end: bounce back to it, carrying the remaining speed.
      if (clamped !== next) this.springTo(clamped, sc.v);
      else if (Math.abs(sc.v) < 12) sc.mode = 'idle';
      this.lastInteraction = performance.now();
    } else if (sc.mode === 'spring') {
      if (!this.offset.step(dt)) sc.mode = 'idle';
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame

  findAnchor(t) {
    // Priority: the most recently started active line, then an interlude,
    // then the last line that has started (short gaps keep the previous line).
    const tl = t + LOOKAHEAD;
    let active = -1, activeBegin = -Infinity, interlude = -1, lastStarted = -1;
    for (const it of this.items) {
      if (it.type === 'interlude') {
        if (t >= it.data.begin && tl < it.data.end) interlude = it.idx;
        continue;
      }
      const l = it.line;
      if (l.begin == null) continue;
      const end = Math.max(l.end, l.background?.end ?? -Infinity);
      if (l.begin <= tl && tl < end && l.begin >= activeBegin) { active = it.idx; activeBegin = l.begin; }
      if (l.begin <= tl) lastStarted = it.idx;
    }
    if (active >= 0) return active;
    if (interlude >= 0) return interlude;
    return lastStarted >= 0 ? lastStarted : 0;
  }

  update(t, dt) {
    if (!this.model) return;
    if (this.needsLayout) this.relayout();
    const jumped = t < this.lastT - 0.05 || t - this.lastT > 1.0;
    this.lastT = t;

    if (!this.static) {
      // Active states
      let reflow = false;
      const scaleChanged = [];
      this.layoutThisFrame = false;
      for (const it of this.lineItems) {
        const l = it.line;
        const mainOn = l.begin != null && l.begin <= t && t < l.end && l.words.length > 0;
        const bg = l.background;
        const bgOn = !!bg && bg.begin != null && bg.begin <= t && t < bg.end;
        if (mainOn !== it.mainOn) { it.mainOn = mainOn; it.el.classList.toggle('main-on', mainOn); }
        if (bgOn !== it.bgOn) { it.bgOn = bgOn; it.el.classList.toggle('bg-on', bgOn); }
        const active = mainOn || bgOn;
        if (active !== it.active) {
          it.active = active;
          it.el.classList.toggle('active', active);
          // When a line ends its words sink back at the speed they rose and
          // held-word swells play out (paintMotion); seeks snap instead.
          if (!active) {
            if (jumped) this.settleWords(it);
            else it.settling = true;
          }
          scaleChanged.push(it);
        }
        // Background vocals unfold while their line is being sung.
        const open = !!bg && active;
        if (open !== it.bgOpen) {
          it.bgOpen = open;
          it.el.classList.toggle('bg-open', open);
          if (it.hOpen !== it.h) reflow = true;
        }
      }

      // Anchor & distance styling
      const anchor = this.findAnchor(t);
      if (anchor !== this.anchor) {
        const prev = this.anchor;
        this.anchor = anchor;
        this.applyDistances();
        if (!this.manual) {
          const far = prev < 0 || Math.abs(anchor - prev) > 3;
          const intoInterlude = this.items[anchor].type === 'interlude';
          this.applyLayout(anchor, jumped || far ? 'seek' : intoInterlude ? 'seek' : 'tick');
        }
      } else if (reflow && !this.manual) {
        this.applyLayout(anchor, 'reflow');
      }
      // Scale changes ride the same cascade as the scroll.
      for (const it of scaleChanged) {
        it.scale.setTarget(it.active ? 1 : SCALE_INACTIVE, this.layoutThisFrame ? it.delay : 0);
      }

      // Word updates: active lines + neighbours of the anchor.
      const hot = this.hot;
      hot.clear();
      for (const it of this.lineItems) if (it.active) hot.add(it);
      for (let d = -1; d <= 1; d++) {
        const it = this.items[anchor + d];
        if (it?.type === 'line') hot.add(it);
      }
      for (const it of hot) {
        if (it.main.mode === 'word') this.paintSweep(it.main, t, it.active);
        if (it.bg?.mode === 'word') this.paintSweep(it.bg, t, it.active);
      }
      for (const it of this.lineItems) {
        if (!it.settling) continue;
        if (it.active || jumped) { if (!it.active) this.settleWords(it); it.settling = false; continue; }
        let busy = false;
        for (const sweep of [it.main, it.bg]) {
          if (sweep?.mode === 'word' && this.paintMotion(sweep, t, dt, false)) busy = true;
        }
        if (!busy) this.settleWords(it);
      }

      for (const it of this.items) if (it.type === 'interlude') this.updateInterlude(it, t, dt);
    }

    // Manual scroll resume
    if (this.manual && !this.static && performance.now() - this.lastInteraction > RESUME_DELAY) {
      this.manual = false;
      this.panel.classList.remove('manual');
      this.applyLayout(this.anchor, 'seek');
      this.springTo(0, this.scroll.mode === 'inertia' ? this.scroll.v : this.offset.velocity, SPRING_SOFT);
    }

    // Springs
    this.stepScroll(dt);
    if (this.offset.value !== this.offsetWritten) {
      this.offsetWritten = this.offset.value;
      this.scroller.style.transform = `translateY(${this.offset.value.toFixed(2)}px)`;
    }
    const cullTop = -this.panelH * 0.5, cullBottom = this.panelH * 1.5;
    for (const it of this.items) {
      let moving = it.spring.step(dt);
      const y = it.spring.value;
      if (it.written === null || Math.abs(y - it.written) > 0.05) {
        it.written = y;
        it.el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
      }
      if (it.scale) {
        const scaling = it.scale.step(dt);
        // While scaling, the line gets its own GPU layer so the text is scaled
        // as an image (smooth sub-pixel motion). Re-rendering the glyphs at each
        // new size makes font hinting snap them, which reads as shimmer/steps.
        // Once it settles the layer is dropped and the text is drawn crisp.
        if (scaling !== it.scaling) {
          it.scaling = scaling;
          it.inner.classList.toggle('scaling', scaling);
        }
        const sv = this.static ? 1 : it.scale.value;
        if (it.scaleWritten === null || Math.abs(sv - it.scaleWritten) > 0.00005) {
          it.scaleWritten = sv;
          it.inner.style.transform = `scale(${sv.toFixed(5)})`;
        }
        moving = moving || scaling;
      }
      if (moving !== it.moving) {
        it.moving = moving;
        it.el.classList.toggle('moving', moving);
      }
      // Lines well outside the panel aren't painted at all.
      const vy = y + this.offset.value;
      const culled = vy > cullBottom || vy + it.hOpen < cullTop;
      if (culled !== it.culled) {
        it.culled = culled;
        it.el.classList.toggle('culled', culled);
      }
    }
  }

  applyDistances() {
    const a = this.anchor;
    const narrow = innerWidth <= 1024;
    for (const it of this.items) {
      // Lines already sung read as one step further away than upcoming ones.
      const d = it.idx < a ? a - it.idx + 1 : it.idx - a;
      let blur = d === 0 ? 0 : Math.min(BLUR_MAX, 1 + d);
      if (narrow) blur *= 0.8;
      if (blur !== it.blur) { it.blur = blur; it.el.style.setProperty('--blur', `${blur}px`); }
    }
  }

  /** Where the sweep's soft front is (line coordinates) at time t. */
  sweepFront(sweep, t) {
    const syls = sweep.syls;
    const n = syls.length;
    if (!n) return 0;
    const half = sweep.fade / 2;
    for (let k = 0; k < n; k++) {
      const s = syls[k];
      // The first syllable starts with the edge fully off the left; the last
      // ends with it fully off the right, so a line goes from dim to lit.
      const from = k === 0 ? -half : s.a;
      const to = k === n - 1 ? sweep.total + half : s.a + s.w;
      if (t < s.begin) return from;
      if (t < s.end) return from + ((t - s.begin) / (s.end - s.begin)) * (to - from);
    }
    return sweep.total + half;
  }

  paintSweep(sweep, t, animate = false) {
    const front = t === Infinity ? Infinity : this.sweepFront(sweep, t);
    if (front !== sweep.lastFront) {
      sweep.lastFront = front;
      const F = sweep.fade;
      for (const w of sweep.words) {
        // Mask image: lit for one box width, soft edge F, dim for one box width.
        // Its x position puts the edge's centre at the front.
        const local = front - w.offset + w.pad;
        const x = Math.min(0, Math.max(-(w.box + F), local - w.box - F / 2));
        if (!(Math.abs(x - w.lastMask) <= 0.1)) {
          w.lastMask = x;
          const pos = `${x.toFixed(1)}px 0`;
          w.el.style.webkitMaskPosition = pos;
          w.el.style.maskPosition = pos;
        }
      }
    }
    if (animate) this.paintMotion(sweep, t, 0, true);
  }

  /**
   * Word lift and held-word swell. While the line is active each word rises
   * with CSS ease-out over max(1 s, its duration); after the line ends it
   * sinks back at that same speed. Returns true while anything still moves.
   */
  paintMotion(sweep, t, dt, active) {
    const em = sweep.fontPx;
    const riseMax = RISE_EM * em * (sweep.isBg ? 2 : 1);
    let busy = false;
    for (const w of sweep.words) {
      w.riseP = active
        ? clamp01((t - w.begin) / w.riseDur)
        : Math.max(0, w.riseP - dt / w.riseDur);
      if (!active && w.riseP > 0) busy = true;
      const rise = -riseMax * cssEaseOut(w.riseP);
      if (!(Math.abs(rise - w.lastRise) <= 0.005)) {
        w.lastRise = rise;
        w.el.style.transform = rise ? `translate3d(0, ${rise.toFixed(3)}px, 0)` : '';
      }
      if (w.emphasis) {
        this.paintEmphasis(w, t, em, sweep.isBg);
        if (!active && t >= w.begin - 0.5 && t < w.begin + w.emph.du * 1.4 + 0.1) busy = true;
      }
    }
    return busy;
  }

  /**
   * Held words: letters swell, push apart, lift and glow one after another
   * (letter i starts du/2.5/n * i later) and float up and back down on a sine
   * that starts 0.4 s early and lasts 1.4x the hold.
   */
  paintEmphasis(w, t, em, isBg) {
    const { du, amount, glow } = w.emph;
    const n = w.letters.length;
    const shadowR = Math.min(0.3, glow * 0.3);
    for (let i = 0; i < n; i++) {
      const l = w.letters[i];
      const start = w.begin + (du / 2.5 / n) * i;
      const e = swellEnvelope((t - start) / du);
      const f = (t - start + 0.4) / (du * 1.4);
      const float = f > 0 && f < 1 ? Math.sin(f * Math.PI) * 0.05 * (isBg ? 2 : 1) : 0;
      const sc = 1 + e * 0.1 * amount;
      const tx = -e * 0.03 * amount * (n / 2 - i) * em;
      const ty = (-e * 0.025 * amount - float) * em;
      const key = `${sc.toFixed(4)}|${tx.toFixed(2)}|${ty.toFixed(2)}`;
      if (key === l.last) continue;
      l.last = key;
      if (e === 0 && float === 0) {
        l.el.style.transform = '';
        l.el.style.textShadow = '';
        continue;
      }
      l.el.style.transform = `scale(${sc.toFixed(4)}) translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
      const ga = e * glow;
      l.el.style.textShadow = ga > 0.003 ? `0 0 ${shadowR.toFixed(3)}em rgba(255,255,255,${ga.toFixed(3)})` : '';
    }
  }

  /** Snap every word and letter back to rest (after a seek or once settled). */
  settleWords(it) {
    it.settling = false;
    for (const sweep of [it.main, it.bg]) {
      if (!sweep) continue;
      for (const w of sweep.words) {
        w.riseP = 0;
        if (w.lastRise) { w.lastRise = 0; w.el.style.transform = ''; }
        for (const l of w.letters) { l.last = ''; l.el.style.transform = ''; l.el.style.textShadow = ''; }
      }
    }
  }

  updateInterlude(it, t, dt) {
    const visible = this.anchor === it.idx;
    if (visible !== it.visible) {
      it.visible = visible;
      it.shown = 0;
      it.el.classList.toggle('visible', visible);
      if (!visible) { it.dotsEl.style.opacity = '0'; it.lastDots = ''; }
    }
    if (!visible) return;
    it.shown += dt;

    // Timeline: enter → body (breathing, dots light in turn) → exit (swell, collapse).
    const intro = it.data.afterLine < 0;
    const start = it.data.begin + (intro ? 0 : 0.25);
    const end = it.data.end - LOOKAHEAD;
    const EXIT = 1.0;
    const body = Math.max(0, end - start - EXIT);
    // Wall-clock fallback so the dots show while paused at the very start.
    const ms = Math.max(t - start, Math.min(it.shown, 0.75 + 0.16)) * 1000;
    const bodyMs = body * 1000;

    const enter = smooth(clamp01(ms / 180));
    const dotEnter = (k) => clamp01((ms - k * 80) / 750) ** 2;
    const breathe = bodyMs >= 3000;
    const seg = (bodyMs + 750) / 3;
    const lit = (from, dur, target = 1) => (ms <= from ? 0 : smooth(clamp01((ms - from) / dur)) * target);
    const dot3Target = breathe ? (bodyMs - 2 * seg) / seg : 1;

    let scale = 1, opacity = enter, fills;
    if (ms < bodyMs) {
      if (breathe) {
        const cycles = Math.max(1, Math.floor(bodyMs / 4000));
        const phase = (ms % (bodyMs / cycles)) / (bodyMs / cycles);
        scale = 1 + 0.25 * (1 - Math.cos(phase * 2 * Math.PI)) / 2;
        fills = [lit(0, seg), lit(seg, seg), lit(2 * seg, bodyMs - 2 * seg, dot3Target)];
      } else {
        fills = [1, 1, 1];
      }
    } else {
      const x = ms - bodyMs;
      scale = x < 750
        ? 1 + easeOutCubic(x / 750) * 0.25
        : 1.25 - easeInCubic(clamp01((x - 750) / 250)) * (1.25 - 0.4);
      opacity = enter * (1 - easeInCubic(clamp01((x - 750) / 250)));
      fills = [1, 1, breathe ? lerp(dot3Target, 1, clamp01(x / 750)) : 1];
    }

    const alphas = fills.map((f, k) => (0.2 + 0.7 * clamp01(f)) * dotEnter(k));
    const key = `${scale.toFixed(3)}|${opacity.toFixed(3)}|${alphas.map((a) => a.toFixed(3)).join()}`;
    if (key === it.lastDots) return;
    it.lastDots = key;
    it.dotsEl.style.transform = `scale(${scale.toFixed(4)})`;
    it.dotsEl.style.opacity = opacity.toFixed(3);
    it.dots.forEach((d, i) => { d.style.opacity = alphas[i].toFixed(3); });
  }
}
