// Liquid Glass: refraction for glass surfaces.
//
// Each glass element gets its own SVG displacement filter whose map matches
// the element's size and corner radius: near the rim the backdrop is pulled
// inward like light through the edge of a lens, the middle stays clear.
// It is applied via `backdrop-filter: url(#…)`, which only Chromium renders
// (Chrome, Edge, the desktop app). Elsewhere the stylesheet's frosted blur and
// rim highlights are used on their own.

const SUPPORTED = /\bChrom(e|ium)\//.test(navigator.userAgent);
const NS = 'http://www.w3.org/2000/svg';
const BAND = 0.45;     // refraction band, as a fraction of the shorter half-side
const MAX_BAND = 22;   // px
const STRENGTH = 0.9;  // displacement in px per px of band

let svg = null;
let counter = 0;
const tracked = new Map(); // element → { id, filter, w, h, r }
let enabled = true;

function root() {
  if (svg) return svg;
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  document.body.appendChild(svg);
  return svg;
}

/** Signed distance from (px, py) to a rounded box centred at 0 with half-size (hx, hy), radius r. */
function sdRoundBox(px, py, hx, hy, r) {
  const qx = Math.abs(px) - hx + r, qy = Math.abs(py) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Displacement map: R/G = x/y offset (0.5 = none), as a data URL. */
function makeMap(w, h, r) {
  const k = Math.min(1, 160 / Math.max(w, h)); // compute at most ~160px, the filter scales it
  const mw = Math.max(8, Math.round(w * k)), mh = Math.max(8, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = mw;
  c.height = mh;
  const g = c.getContext('2d');
  const img = g.createImageData(mw, mh);
  const hx = w / 2, hy = h / 2;
  const band = Math.min(MAX_BAND, Math.min(hx, hy) * BAND);
  const rr = Math.min(r, hx, hy);
  const e = 0.5;
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const x = ((i + 0.5) / mw) * w - hx, y = ((j + 0.5) / mh) * h - hy;
      const d = -sdRoundBox(x, y, hx, hy, rr); // depth inside the shape (px)
      let dx = 0, dy = 0;
      if (d > 0 && d < band) {
        // Outward normal from the SDF gradient.
        const nx = sdRoundBox(x + e, y, hx, hy, rr) - sdRoundBox(x - e, y, hx, hy, rr);
        const ny = sdRoundBox(x, y + e, hx, hy, rr) - sdRoundBox(x, y - e, hx, hy, rr);
        const len = Math.hypot(nx, ny) || 1;
        // Strongest at the rim, easing to nothing at the band's inner edge.
        const t = 1 - d / band;
        const m = t * t * (3 - 2 * t);
        dx = (-nx / len) * m;
        dy = (-ny / len) * m;
      }
      const o = (j * mw + i) * 4;
      img.data[o] = Math.round(128 + 127 * dx);
      img.data[o + 1] = Math.round(128 + 127 * dy);
      img.data[o + 2] = 128;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { url: c.toDataURL(), scale: 2 * band * STRENGTH };
}

function build(el, entry) {
  const rect = el.getBoundingClientRect();
  const w = Math.round(el.offsetWidth || rect.width), h = Math.round(el.offsetHeight || rect.height);
  if (w < 4 || h < 4) return;
  const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  if (entry.w === w && entry.h === h && entry.r === r) return;
  entry.w = w; entry.h = h; entry.r = r;
  const { url, scale } = makeMap(w, h, r);
  const f = entry.filter;
  f.setAttribute('width', String(w));
  f.setAttribute('height', String(h));
  const image = f.querySelector('feImage');
  image.setAttribute('href', url);
  image.setAttribute('width', String(w));
  image.setAttribute('height', String(h));
  f.querySelector('feDisplacementMap').setAttribute('scale', String(scale.toFixed(1)));
}

const resizeObserver = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver((entries) => {
    for (const { target } of entries) {
      const entry = tracked.get(target);
      if (entry) build(target, entry);
    }
  })
  : null;

/** Make an element refract its backdrop (no-op where unsupported). */
export function glass(el) {
  if (!SUPPORTED || !el || tracked.has(el)) return;
  const id = `lg-${++counter}`;
  const filter = document.createElementNS(NS, 'filter');
  filter.id = id;
  filter.setAttribute('x', '0');
  filter.setAttribute('y', '0');
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB');
  const image = document.createElementNS(NS, 'feImage');
  image.setAttribute('x', '0');
  image.setAttribute('y', '0');
  image.setAttribute('preserveAspectRatio', 'none');
  image.setAttribute('result', 'map');
  const disp = document.createElementNS(NS, 'feDisplacementMap');
  disp.setAttribute('in', 'SourceGraphic');
  disp.setAttribute('in2', 'map');
  disp.setAttribute('xChannelSelector', 'R');
  disp.setAttribute('yChannelSelector', 'G');
  filter.append(image, disp);
  root().appendChild(filter);
  const entry = { id, filter, w: 0, h: 0, r: -1 };
  tracked.set(el, entry);
  el.style.setProperty('--lg-filter', `url(#${id})`);
  el.classList.add('lg-refract');
  build(el, entry);
  resizeObserver?.observe(el);
}

/** Apply to every element matching selector (now) — call again for new elements. */
export function glassAll(selector) {
  for (const el of document.querySelectorAll(selector)) glass(el);
}

// The system's "reduce transparency" setting wins over the app's Liquid Glass setting.
const reducedTransparency = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-transparency: reduce)') : null;
let wanted = false;
function applyGlass() {
  const on = wanted && !reducedTransparency?.matches;
  enabled = on;
  document.documentElement.classList.toggle('glass', on);
  document.documentElement.classList.toggle('lg-supported', on && SUPPORTED);
}
reducedTransparency?.addEventListener?.('change', applyGlass);

export function setGlassEnabled(on) {
  wanted = on;
  applyGlass();
}

export const glassSupported = SUPPORTED;
export const glassEnabled = () => enabled;
