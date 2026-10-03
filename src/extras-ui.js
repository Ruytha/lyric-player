// Settings rows built by hand for the newer extras (global shortcuts, phone
// remote) and the lyric font / colour.

import qrcode from './vendor/qrcode.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const NAMES = { toggle: 'Play / pause', next: 'Next song', prev: 'Previous song', bar: 'Floating lyrics on / off', window: 'Show / hide the player' };

/** Settings → App: the list of global shortcuts (needs app 2.9.0+). */
export function buildHotkeysRow(row, { native }) {
  row.classList.add('hotkeys-row');
  if (!native?.appPrefs) { row.hidden = true; return; }
  native.appPrefs('hotkeys').then((r) => {
    if (!r?.list) { row.innerHTML = '<div class="set-hint">Global shortcuts need the newest Lyric Player installer.</div>'; return; }
    row.innerHTML = `<div class="hk-list">${r.list.map(([k, c]) => `<div class="hk"><span>${esc(NAMES[c] || c)}</span><span class="hk-keys"><kbd>${k.split('+').map(esc).join('</kbd><kbd>')}</kbd></span></div>`).join('')}</div>
      ${r.failed?.length ? `<div class="set-hint">Taken by another app: ${r.failed.map(esc).join(', ')}</div>` : ''}`;
  }).catch(() => { row.hidden = true; });
}

/** An SVG QR code for `text`. */
export function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), q = 2;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) path += `M${x + q} ${y + q}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + q * 2} ${n + q * 2}" shape-rendering="crispEdges" aria-hidden="true"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** Settings → Phone remote: QR code and link to open on the phone. Returns refresh(). */
export function buildRemoteRow(row, { native, settings, toast }) {
  row.classList.add('remote-row');
  if (!native?.appPrefs) { row.hidden = true; return () => {}; }
  let urls = [], pick = 0;
  const render = () => {
    if (!settings.get('remote')) { row.innerHTML = '<div class="set-hint">Turn it on, then scan the code with your phone’s camera. Your phone needs to be on the same Wi-Fi.</div>'; return; }
    if (!urls.length) { row.innerHTML = '<div class="set-hint">Starting… If nothing appears, this PC may not be on a network, or the newest installer is needed.</div>'; return; }
    const url = urls[pick % urls.length];
    row.innerHTML = `
      <div class="rm-box">
        <div class="rm-qr">${qrSvg(url)}</div>
        <div class="rm-text">
          <div class="set-label">Scan with your phone</div>
          <div class="set-hint">Or open this on a phone on the same Wi-Fi:</div>
          <code class="rm-url">${esc(url)}</code>
          <div class="acct-buttons">
            <button type="button" class="pill pill-small pill-ghost" data-copy>Copy link</button>
            ${urls.length > 1 ? '<button type="button" class="pill pill-small pill-ghost" data-other>Other network</button>' : ''}
            <button type="button" class="pill pill-small pill-ghost" data-new>New code</button>
          </div>
        </div>
      </div>
      <div class="set-hint">Windows may ask whether Lyric Player can use your network the first time: allow it on private networks. “New code” disconnects phones you’ve used before.</div>`;
  };
  const load = async () => {
    const r = await native.appPrefs('remote-info').catch(() => null);
    urls = r?.urls || [];
    render();
  };
  row.addEventListener('click', async (e) => {
    if (e.target.closest('[data-copy]')) { navigator.clipboard.writeText(urls[pick % urls.length]).then(() => toast('Link copied')).catch(() => {}); }
    if (e.target.closest('[data-other]')) { pick++; render(); }
    if (e.target.closest('[data-new]')) { const r = await native.appPrefs('remote-new-code').catch(() => null); urls = r?.urls || urls; render(); toast('New code made: scan it again on your phone'); }
  });
  load();
  return () => setTimeout(load, 300);
}

// ---------------------------------------------------------------------------
// Lyric font and colour (Settings → Lyrics)

const FONTS = {
  default: { css: null },
  rounded: { css: '"SF Pro Rounded", "Nunito", var(--font)', google: 'Nunito:wght@400;600;700;800;900' },
  serif: { css: '"New York", "Playfair Display", Georgia, serif', google: 'Playfair+Display:wght@400;600;700;800;900' },
  mono: { css: '"SF Mono", "JetBrains Mono", Consolas, monospace', google: 'JetBrains+Mono:wght@400;600;700;800' },
  playful: { css: '"Baloo 2", var(--font)', google: 'Baloo+2:wght@400;600;700;800' },
};
const COLORS = { white: null, warm: '#ffe7c4', pink: '#ffc3d6', mint: '#c6ffe5', sky: '#cfe4ff', lilac: '#e3d2ff' };

function loadGoogleFont(spec) {
  const id = `gf-${spec.split(':')[0]}`;
  if (document.getElementById(id)) return;
  const l = document.createElement('link');
  l.id = id; l.rel = 'stylesheet';
  l.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`;
  document.head.appendChild(l);
}

const accentCache = new Map();
/** A light, saturated colour from the cover, for "Cover" lyrics. */
async function coverAccent(url) {
  if (!url) return null;
  if (accentCache.has(url)) return accentCache.get(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  try { await img.decode(); } catch { return null; }
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 24, 24);
  let data;
  try { data = ctx.getImageData(0, 0, 24, 24).data; } catch { return null; }
  // The most colourful pixels, averaged, then lifted to a pastel.
  const px = [];
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    px.push({ r, g, b, s: max ? (max - min) / max : 0 });
  }
  px.sort((a, b) => b.s - a.s);
  const top = px.slice(0, 60);
  const avg = (k) => top.reduce((sum, p) => sum + p[k], 0) / top.length;
  const lift = (v) => Math.round(255 - (255 - v) * 0.35);
  const color = top[0].s < 0.15 ? null : `rgb(${lift(avg('r'))}, ${lift(avg('g'))}, ${lift(avg('b'))})`;
  accentCache.set(url, color);
  return color;
}

export async function applyLyricLook(s, { art } = {}) {
  const root = document.documentElement.style;
  const f = FONTS[s.lyricFont] || FONTS.default;
  if (f.google) loadGoogleFont(f.google);
  if (f.css) root.setProperty('--font-lyric', f.css); else root.removeProperty('--font-lyric');
  let color = COLORS[s.lyricColor] ?? null;
  if (s.lyricColor === 'cover') color = await coverAccent(art?.());
  const lyrics = document.getElementById('lyrics');
  if (color) { lyrics?.style.setProperty('--amll-lp-color', color); lyrics?.style.setProperty('--lyric-color', color); }
  else { lyrics?.style.removeProperty('--amll-lp-color'); lyrics?.style.removeProperty('--lyric-color'); }
}
