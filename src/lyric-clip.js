// Lyric clips (••• → Share → Lyric clip): records a short video of the lyrics
// moving over the cover, for stories and posts. It's recorded in real time
// while the song plays. Sound is only included for your own song files;
// music followed from Spotify or Apple Music is never recorded.

const FORMATS = {
  story: { w: 1080, h: 1920, label: 'Story 9:16' },
  square: { w: 1080, h: 1080, label: 'Square' },
  wide: { w: 1920, h: 1080, label: 'Wide 16:9' },
};
const FPS = 30;

const ease = (x) => 1 - (1 - x) ** 3;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function pickMime(withAudio) {
  const list = withAudio
    ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/mp4;codecs=avc1.640028', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return list.find((m) => globalThis.MediaRecorder?.isTypeSupported?.(m)) || '';
}

/** Splits words into rows that fit `max` px. */
function layoutWords(ctx, words, max) {
  const rows = [[]];
  let x = 0;
  for (const w of words) {
    const text = (w.spaceBefore && rows.at(-1).length ? ' ' : '') + w.text;
    const width = ctx.measureText(text).width;
    if (x + width > max && rows.at(-1).length) { rows.push([]); x = 0; }
    const t = rows.at(-1).length ? text : w.text;
    rows.at(-1).push({ ...w, draw: t, x, width: ctx.measureText(t).width });
    x += ctx.measureText(t).width;
  }
  return rows;
}

const lineWords = (line) => (line.words?.length
  ? line.words.map((w) => ({ text: w.text, begin: w.begin, end: w.end, spaceBefore: w.spaceBefore !== false }))
  : String(line.text || '').split(/\s+/).filter(Boolean).map((t, i, a) => {
    const d = (line.end - line.begin) / a.length;
    return { text: t, begin: line.begin + i * d, end: line.begin + (i + 1) * d, spaceBefore: true };
  }));

/** Draws one frame at lyric time t. */
export function drawClipFrame(ctx, { w, h }, { model, t, title, artist, art, bg, font }) {
  // Background: the moving one from the player when there is one, else the blurred cover.
  ctx.fillStyle = '#1b1f2a';
  ctx.fillRect(0, 0, w, h);
  const cover = (img, blur, scale, alpha = 1) => {
    if (!img) return;
    const s = Math.max(w / img.width, h / img.height) * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = blur ? `blur(${blur}px) saturate(1.5) brightness(0.7)` : 'none';
    ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
    ctx.restore();
  };
  if (bg) cover(bg, 0, 1);
  else cover(art, 80, 1.25 + 0.05 * Math.sin(t / 3));
  const shade = ctx.createLinearGradient(0, 0, 0, h);
  shade.addColorStop(0, 'rgba(0,0,0,0.25)');
  shade.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);

  const u = Math.min(w, h) / 1080;
  const pad = 90 * u;
  // Header: cover, title, artist.
  const artSize = 150 * u;
  const top = h > w ? 170 * u : 90 * u;
  if (art) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(pad, top, artSize, artSize, 18 * u);
    ctx.clip();
    ctx.drawImage(art, pad, top, artSize, artSize);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${46 * u}px ${font}`;
  const textX = pad + (art ? artSize + 34 * u : 0);
  const clip = (s, max) => { let x = s; while (x.length > 1 && ctx.measureText(x).width > max) x = x.slice(0, -2); return x === s ? s : `${x}…`; };
  ctx.fillText(clip(title || '', w - textX - pad), textX, top + artSize / 2 - 6 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = `500 ${38 * u}px ${font}`;
  ctx.fillText(clip(artist || '', w - textX - pad), textX, top + artSize / 2 + 44 * u);

  // Lyrics: the current line big, lit word by word; the next one dim below.
  const lines = model.lines;
  let i = lines.findIndex((l) => l.begin > t) - 1;
  if (i === -2) i = lines.length - 1; // past the last line's start
  const cur = i >= 0 ? lines[i] : null;
  const next = lines[i + 1] || null;
  const size = (h > w ? 92 : 80) * u;
  const lh = size * 1.18;
  const maxW = w - pad * 2;
  const midY = h > w ? h * 0.5 : h * 0.55;
  ctx.font = `800 ${size}px ${font}`;

  const enter = cur ? ease(clamp01((t - cur.begin) / 0.45)) : 1;
  let y = midY + (1 - enter) * lh * 0.8;
  if (cur && t <= cur.end + 2.5) {
    const rows = layoutWords(ctx, lineWords(cur), maxW);
    ctx.save();
    ctx.globalAlpha = 0.4 + 0.6 * enter;
    for (const row of rows) {
      for (const wd of row) {
        const x = pad + wd.x;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText(wd.draw, x, y);
        const p = clamp01((t - wd.begin) / Math.max(0.05, wd.end - wd.begin));
        if (p > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y - size, wd.width * p, size * 1.4);
          ctx.clip();
          ctx.shadowColor = 'rgba(255,255,255,0.45)';
          ctx.shadowBlur = 24 * u * p;
          ctx.fillStyle = '#fff';
          ctx.fillText(wd.draw, x, y);
          ctx.restore();
        }
      }
      y += lh;
    }
    ctx.restore();
  }
  if (next) {
    ctx.font = `800 ${size * 0.62}px ${font}`;
    ctx.fillStyle = `rgba(255,255,255,${0.3 * enter})`;
    const rows = layoutWords(ctx, lineWords(next), maxW);
    y += size * 0.35;
    for (const row of rows.slice(0, 2)) {
      for (const wd of row) ctx.fillText(wd.draw, pad + wd.x, y);
      y += size * 0.62 * 1.2;
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `600 ${30 * u}px ${font}`;
  ctx.fillText('♫ Lyric Player', pad, h - (h > w ? 140 : 70) * u);
}

/** True when a canvas is (nearly) black or empty. */
const probe = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function isBlank(c) {
  try {
    probe.width = probe.height = 8;
    const x = probe.getContext('2d', { willReadFrequently: true });
    x.clearRect(0, 0, 8, 8);
    x.drawImage(c, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
    return sum / (d.length / 4) < 24;
  } catch { return true; }
}

const loadImage = (url) => new Promise((resolve) => {
  if (!url) { resolve(null); return; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = url;
});

export class LyricClip {
  /**
   * h: { data() → { model, title, artist, art, time, ownAudio }, background() → canvas|null,
   *      audioStream() → MediaStream|null, stopAudioStream(), playFrom(t), pause(), lyricTime(), toast }
   */
  constructor(h) {
    this.h = h;
    this.root = null;
  }

  open() {
    const d = this.h.data();
    if (!d.model || d.model.timing === 'none' || !d.model.lines.length) { this.h.toast('Lyric clips need synced lyrics'); return; }
    if (!globalThis.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { this.h.toast('This browser can’t record video'); return; }
    this.close();
    const root = this.root = document.createElement('div');
    root.className = 'lyric-search whats-new clip';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Lyric clip');
    const line = d.model.lines.find((l) => l.end > d.time) || d.model.lines[0];
    this.start = Math.max(0, line.begin - 0.6);
    root.innerHTML = `
      <div class="ls-panel wn-panel cl-panel">
        <div class="card-head">
          <h2>Lyric clip</h2>
          <button class="sheet-btn sheet-close" data-close type="button" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </div>
        <div class="wn-body cl-body">
          <canvas class="cl-preview"></canvas>
          <div class="cl-opts">
            <div class="seg cl-format" role="radiogroup" aria-label="Shape">${Object.entries(FORMATS).map(([k, f]) => `<button type="button" data-format="${k}" role="radio">${f.label}</button>`).join('')}</div>
            <div class="seg cl-len" role="radiogroup" aria-label="Length">${[10, 15, 30].map((s) => `<button type="button" data-len="${s}" role="radio">${s} s</button>`).join('')}</div>
            <label class="cl-check"><input type="checkbox" class="cl-audio" ${d.ownAudio ? 'checked' : 'disabled'}> Include the song’s sound${d.ownAudio ? '' : ' (only for your own song files)'}</label>
            <p class="cl-hint">Starts at “${line.text.replace(/</g, '&lt;').slice(0, 60)}”. The song plays while it records.</p>
            <div class="cl-progress" hidden><div class="cl-fill"></div></div>
          </div>
        </div>
        <div class="acct-buttons wn-foot"><button class="pill pill-small cl-go" type="button">Record</button></div>
      </div>`;
    document.body.appendChild(root);
    this.format = 'story';
    this.len = 15;
    const sync = () => {
      for (const b of root.querySelectorAll('[data-format]')) b.setAttribute('aria-checked', String(b.dataset.format === this.format));
      for (const b of root.querySelectorAll('[data-len]')) b.setAttribute('aria-checked', String(+b.dataset.len === this.len));
      this.preview();
    };
    root.addEventListener('click', (e) => {
      const f = e.target.closest('[data-format]'), l = e.target.closest('[data-len]');
      if (f) { this.format = f.dataset.format; sync(); }
      if (l) { this.len = +l.dataset.len; sync(); }
    });
    root.querySelector('.cl-go').addEventListener('click', () => (this.rec ? this.stop() : this.record()));
    for (const b of root.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.close());
    root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.close(); });
    loadImage(d.art).then((img) => { this.art = img; this.preview(); });
    sync();
    requestAnimationFrame(() => root.classList.add('open'));
  }

  font() { return getComputedStyle(document.documentElement).getPropertyValue('--font-lyric').trim() || 'system-ui, sans-serif'; }

  frame(canvas, t) {
    const f = FORMATS[this.format];
    const d = this.h.data();
    let bg = this.h.background();
    if (bg && isBlank(bg)) bg = null; // the moving background isn't drawing: use the cover
    drawClipFrame(canvas.getContext('2d'), f, { model: d.model, t, title: d.title, artist: d.artist, art: this.art, bg, font: this.font() });
  }

  preview() {
    const c = this.root?.querySelector('.cl-preview');
    if (!c || this.rec) return;
    const f = FORMATS[this.format];
    c.width = f.w; c.height = f.h;
    const d = this.h.data();
    const line = d.model.lines.find((l) => l.begin >= this.start + 0.5) || d.model.lines[0];
    this.frame(c, line.begin + Math.min(1.2, (line.end - line.begin) * 0.6));
  }

  async record() {
    const root = this.root;
    const d = this.h.data();
    const f = FORMATS[this.format];
    const canvas = root.querySelector('.cl-preview');
    canvas.width = f.w; canvas.height = f.h;
    const withAudio = root.querySelector('.cl-audio').checked && d.ownAudio;
    const mime = pickMime(withAudio);
    const video = canvas.captureStream(FPS);
    const tracks = [...video.getVideoTracks()];
    if (withAudio) {
      this.h.playFrom(this.start);
      await new Promise((r) => setTimeout(r, 150));
      const a = this.h.audioStream();
      if (a) tracks.push(...a.getAudioTracks());
    }
    const stream = new MediaStream(tracks);
    const chunks = [];
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 10_000_000 }); } catch (e) { this.h.toast(`Can’t record: ${e.message}`, { error: true }); return; }
    this.rec = rec;
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    const go = root.querySelector('.cl-go');
    go.textContent = 'Stop';
    root.querySelector('.cl-progress').hidden = false;
    root.classList.add('recording');
    rec.start(500);
    const began = performance.now();
    const own = withAudio;
    // A timer, not animation frames: those stop when the window is hidden.
    const timer = setInterval(() => {
      if (!this.rec) { clearInterval(timer); return; }
      const elapsed = (performance.now() - began) / 1000;
      // With sound the song's own clock leads; silent clips run on their own time.
      const t = own ? this.h.lyricTime() : this.start + elapsed;
      this.frame(canvas, t);
      root.querySelector('.cl-fill').style.width = `${clamp01(elapsed / this.len) * 100}%`;
      if (elapsed >= this.len) { clearInterval(timer); this.stop(); }
    }, 1000 / FPS);
    await done;
    for (const tr of tracks) if (tr.kind === 'video') tr.stop();
    if (withAudio) { this.h.stopAudioStream?.(); this.h.pause(); }
    root.classList.remove('recording');
    go.textContent = 'Record';
    root.querySelector('.cl-progress').hidden = true;
    if (!chunks.length) return;
    const type = rec.mimeType || mime || 'video/webm';
    const blob = new Blob(chunks, { type });
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const name = `${(d.title || 'lyrics').replace(/[\\/:*?"<>|]+/g, ' ')} - lyric clip.${ext}`;
    const file = new File([blob], name, { type });
    if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      navigator.share({ files: [file] }).catch(() => {});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
    this.h.toast(`Saved ${name}`);
  }

  stop() {
    const r = this.rec;
    this.rec = null;
    if (r && r.state !== 'inactive') r.stop();
  }

  close() {
    this.stop();
    const r = this.root;
    if (!r) return;
    this.root = null;
    r.classList.remove('open');
    setTimeout(() => r.remove(), 250);
  }
}
