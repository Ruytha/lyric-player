// Lyric cards: pick a few lines and save (or copy) an Apple Music–style image
// of them, on the cover's colours, for sharing.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const W = 1080, H = 1350, PAD = 96;
const MAX_LINES = 6;

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(null); return; }
    const img = new Image();
    if (!/^(blob|data):/.test(url)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, width) {
  const words = String(text).split(/(\s+)/);
  const out = [];
  let line = '';
  for (const w of words) {
    const next = line + w;
    if (line && ctx.measureText(next.trim()).width > width) { out.push(line.trim()); line = w.trimStart(); }
    else line = next;
  }
  if (line.trim()) out.push(line.trim());
  // Very long words / CJK without spaces: break by character.
  return out.flatMap((l) => {
    if (ctx.measureText(l).width <= width) return [l];
    const parts = [];
    let cur = '';
    for (const ch of l) {
      if (ctx.measureText(cur + ch).width > width && cur) { parts.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) parts.push(cur);
    return parts;
  });
}

/** Draws the card. data: { lines: [{text, translation}], title, artist, art (url), style ('dark' | 'light' | 'lyricify'), showTranslation, motionBg() → canvas } */
export async function drawCard(canvas, data) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = getComputedStyle(document.documentElement).getPropertyValue('--font') || 'Inter, sans-serif';
  const img = await loadImage(data.art);

  // Background: the cover, hugely blurred and darkened (like the player).
  ctx.fillStyle = '#2a2f3a';
  ctx.fillRect(0, 0, W, H);
  // Lyricify: a frame of the player's own moving background.
  const snap = data.style === 'lyricify' ? data.motionBg?.() : null;
  if (snap) {
    const k = Math.max(W / snap.width, H / snap.height);
    ctx.drawImage(snap, (W - snap.width * k) / 2, (H - snap.height * k) / 2, snap.width * k, snap.height * k);
  } else if (img) {
    ctx.save();
    ctx.filter = 'blur(90px) saturate(1.6)';
    const s = Math.max(W, H) * 1.5;
    ctx.drawImage(img, (W - s) / 2, (H - s) / 2, s, s);
    ctx.restore();
  }
  ctx.fillStyle = data.style === 'light' ? 'rgba(255,255,255,0.18)' : snap ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.32)';
  ctx.fillRect(0, 0, W, H);

  // Header: cover, title, artist.
  const art = 168;
  if (img) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 14;
    roundRect(ctx, PAD, PAD, art, art, 18);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, PAD, PAD, art, art, 18);
    ctx.clip();
    ctx.drawImage(img, PAD, PAD, art, art);
    ctx.restore();
  }
  const tx = img ? PAD + art + 36 : PAD;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 44px ${font}`;
  const clip = (t, w) => { let s = String(t || ''); while (s && ctx.measureText(s).width > w) s = s.slice(0, -2) + '…'; return s; };
  ctx.fillText(clip(data.title, W - tx - PAD), tx, PAD + 72);
  ctx.font = `400 40px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(clip(data.artist, W - tx - PAD), tx, PAD + 126);

  // Lyrics: big and bold, shrinking to fit.
  const maxW = W - PAD * 2;
  const top = PAD + art + 110, bottom = H - PAD - 70;
  let size = 84, blocks;
  for (; size >= 40; size -= 4) {
    ctx.font = `800 ${size}px ${font}`;
    blocks = data.lines.map((l) => {
      ctx.font = `800 ${size}px ${font}`;
      const main = wrap(ctx, l.text, maxW);
      ctx.font = `600 ${Math.round(size * 0.52)}px ${font}`;
      const tr = data.showTranslation && l.translation ? wrap(ctx, l.translation, maxW) : [];
      return { main, tr };
    });
    const h = blocks.reduce((a, b) => a + b.main.length * size * 1.18 + b.tr.length * size * 0.66 + size * 0.42, 0);
    if (h <= bottom - top) break;
  }
  let y = top + size;
  for (const b of blocks) {
    ctx.font = `800 ${size}px ${font}`;
    ctx.fillStyle = '#fff';
    for (const line of b.main) { ctx.fillText(line, PAD, y); y += size * 1.18; }
    ctx.font = `600 ${Math.round(size * 0.52)}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const line of b.tr) { ctx.fillText(line, PAD, y - size * 0.4); y += size * 0.66; }
    y += size * 0.42;
  }

  // Footer mark.
  ctx.font = `600 30px ${font}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('♫ Lyric Player', PAD, H - PAD + 10);
  if (data.credit) {
    // Required by Spicy Lyrics wherever its lyrics appear.
    ctx.font = `500 24px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.textAlign = 'right';
    ctx.fillText(data.credit, W - PAD, H - PAD + 10);
    ctx.textAlign = 'left';
  }
}

export class LyricCardDialog {
  /** h: { get() → { model, title, artist, art, time }, toast } */
  constructor(root, h) {
    this.root = root;
    this.h = h;
    this.canvas = root.querySelector('canvas');
    this.list = root.querySelector('.card-lines');
    this.selected = new Set();
    this.style = 'dark';
    this.showTranslation = true;
    this.timer = 0;
    root.querySelector('[data-close]').addEventListener('click', () => this.close());
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
    root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.close(); });
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-i]');
      if (!row) return;
      const i = Number(row.dataset.i);
      if (this.selected.has(i)) this.selected.delete(i);
      else if (this.selected.size < MAX_LINES) this.selected.add(i);
      else { this.h.toast(`Up to ${MAX_LINES} lines`); return; }
      row.classList.toggle('sel', this.selected.has(i));
      this.redraw();
    });
    for (const b of root.querySelectorAll('[data-style]')) b.addEventListener('click', () => {
      this.style = b.dataset.style;
      for (const x of root.querySelectorAll('[data-style]')) x.setAttribute('aria-checked', String(x === b));
      this.redraw();
    });
    root.querySelector('[data-trans]').addEventListener('change', (e) => { this.showTranslation = e.target.checked; this.redraw(); });
    root.querySelector('[data-save]').addEventListener('click', () => this.save());
    root.querySelector('[data-copy]').addEventListener('click', () => this.copy());
  }

  get isOpen() { return !this.root.hidden; }

  open() {
    const d = this.h.get();
    const lines = (d.model?.lines || []).filter((l) => l.text);
    if (!lines.length) { this.h.toast('Load lyrics first', { error: true }); return; }
    this.data = d;
    this.lines = lines;
    // Start with the line playing now (and the next one).
    const cur = Math.max(0, lines.findLastIndex((l) => l.begin != null && l.begin <= d.time));
    this.selected = new Set([cur, cur + 1].filter((i) => i < lines.length));
    this.list.innerHTML = lines.map((l, i) => `<button class="card-line${this.selected.has(i) ? ' sel' : ''}" data-i="${i}">${esc(l.text)}</button>`).join('');
    this.root.querySelector('[data-trans]').closest('label').hidden = !lines.some((l) => l.translation);
    this.root.hidden = false;
    requestAnimationFrame(() => {
      this.root.classList.add('open');
      this.list.children[cur]?.scrollIntoView({ block: 'center' });
    });
    this.redraw();
  }

  close() {
    this.root.classList.remove('open');
    setTimeout(() => { if (!this.root.classList.contains('open')) this.root.hidden = true; }, 250);
  }

  redraw() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const picked = [...this.selected].sort((a, b) => a - b).map((i) => this.lines[i]);
      drawCard(this.canvas, { ...this.data, lines: picked, style: this.style, showTranslation: this.showTranslation });
    }, 30);
  }

  blob() { return new Promise((r) => this.canvas.toBlob(r, 'image/png')); }

  async save() {
    const blob = await this.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(this.data.title || 'lyrics').replace(/[\\/:*?"<>|]+/g, ' ')} - lyric card.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async copy() {
    try {
      const blob = await this.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.h.toast('Lyric card copied');
    } catch (e) {
      this.h.toast(`Couldn’t copy the image (${e.message})`, { error: true });
    }
  }
}
