// Documentation: one article at a time (by #id). The navigator, title banners,
// breadcrumbs, topic lists and previous / next links are all built from the
// articles themselves (data-id, data-title, data-group, data-abstract).

const articles = [...document.querySelectorAll('article[data-id]')];
const byId = new Map(articles.map((a) => [a.dataset.id, a]));
const groups = [];
for (const a of articles) {
  const g = a.dataset.group;
  if (!g) continue;
  let group = groups.find((x) => x.name === g);
  if (!group) groups.push((group = { name: g, items: [] }));
  group.items.push(a);
}
const ordered = groups.flatMap((g) => g.items);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const PAGE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2h5l2.5 2.5V14h-7.5z"/><path d="M6.5 7h3.5M6.5 9.5h3.5"/></svg>';
const KEYS = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="4" width="12.4" height="8" rx="1.6"/><path d="M4.5 6.6h.1M7 6.6h.1M9.5 6.6h.1M5 9.4h6"/></svg>';
const icon = (a) => `<span class="doc-icon g-${slug(a.dataset.group || 'essentials')}">${a.dataset.kind === 'reference' ? KEYS : PAGE}</span>`;

// ---------------------------------------------------------------------------
// Title banners and section headings

for (const a of articles) {
  const kind = a.querySelector('.kind'), h1 = a.querySelector('h1'), abs = a.querySelector('.abstract');
  if (kind?.textContent.trim() === 'Reference') a.dataset.kind = 'reference';
  const hero = document.createElement('header');
  hero.className = 'hero';
  if (a.dataset.group) hero.dataset.group = a.dataset.group;
  const inner = document.createElement('div');
  inner.className = 'hero-inner';
  if (kind && a.dataset.group) kind.innerHTML = `${icon(a)}${esc(kind.textContent)}`;
  inner.append(...[a.querySelector('.hero-icon'), kind, h1, abs, a.querySelector('.platforms')].filter(Boolean));
  hero.append(inner);
  const body = document.createElement('div');
  body.className = 'body';
  body.append(...a.childNodes);
  a.append(hero, body);
  // The first heading of the article reads "Overview", as in Apple's docs.
  if (a.dataset.overview !== 'false' && a.dataset.id !== 'overview') {
    const first = body.querySelector(':scope > :not(figure):not(.pair):not(.aside)');
    if (first && first.tagName !== 'H3') {
      const h = document.createElement('h2');
      h.className = 'section';
      h.textContent = 'Overview';
      body.prepend(h);
    }
  }
}

// ---------------------------------------------------------------------------
// Navigator

const tree = document.getElementById('navTree');
const openGroups = new Set(groups.map((g) => g.name));
function renderNav(filter = '') {
  const q = filter.trim().toLowerCase();
  const match = (a) => !q || `${a.dataset.title} ${a.dataset.abstract || ''} ${a.textContent}`.toLowerCase().includes(q);
  const html = [];
  let any = false;
  for (const g of groups) {
    const items = g.items.filter(match);
    if (!items.length) continue;
    any = true;
    const open = q || openGroups.has(g.name);
    html.push(`<div class="nav-group g-${slug(g.name)}" data-name="${esc(g.name)}" aria-expanded="${!!open}">
      <button type="button" aria-expanded="${!!open}"><svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="m4.5 2.5 3.5 3.5-3.5 3.5"/></svg>${esc(g.name)}</button>
      <div class="nav-items"><div>${items.map((a) => `<a class="nav-link" href="#${a.dataset.id}" data-id="${a.dataset.id}"${open ? '' : ' tabindex="-1"'}>${icon(a)}<span>${esc(a.dataset.title)}</span></a>`).join('')}</div></div>
    </div>`);
  }
  if (!any) html.push('<p class="nav-empty">No topics match.</p>');
  tree.innerHTML = html.join('');
  markCurrent();
}
tree.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-group > button');
  if (!btn) return;
  const group = btn.parentElement;
  const open = group.getAttribute('aria-expanded') !== 'true';
  group.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-expanded', String(open));
  for (const l of group.querySelectorAll('.nav-link')) l.tabIndex = open ? 0 : -1;
  if (open) openGroups.add(group.dataset.name); else openGroups.delete(group.dataset.name);
});
document.querySelector('.filter').addEventListener('input', (e) => renderNav(e.target.value));

// ---------------------------------------------------------------------------
// Topic lists: the overview lists every group; "See Also" lists named articles.

const card = (a) => `<a class="topic-card" href="#${a.dataset.id}">${icon(a)}<b>${esc(a.dataset.title)}</b><span>${esc(a.dataset.abstract || '')}</span></a>`;
document.getElementById('overviewTopics').innerHTML = groups
  .map((g) => `<div class="topic-group"><h4>${esc(g.name)}</h4><div class="topic-links">${g.items.map(card).join('')}</div></div>`)
  .join('');
for (const box of document.querySelectorAll('[data-see]')) {
  const items = box.dataset.see.split(/\s+/).map((id) => byId.get(id)).filter(Boolean);
  box.innerHTML = `<div class="topic-group"><h4>Related</h4><div class="topic-links">${items.map(card).join('')}</div></div>`;
}

// Previous / next, in navigator order.
ordered.forEach((a, i) => {
  const prev = ordered[i - 1], next = ordered[i + 1];
  const nav = document.createElement('nav');
  nav.className = 'pager';
  nav.setAttribute('aria-label', 'More topics');
  nav.innerHTML = (prev ? `<a class="prev" href="#${prev.dataset.id}"><small>Previous</small><b>${esc(prev.dataset.title)}</b></a>` : '')
    + (next ? `<a class="next" href="#${next.dataset.id}"><small>Next</small><b>${esc(next.dataset.title)}</b></a>` : '');
  a.querySelector('.body').append(nav);
});

// ---------------------------------------------------------------------------
// Routing, with a cross-fade between pages where the browser can do it.

const crumbs = document.getElementById('crumbs');
const menuBtn = document.querySelector('.menu-btn');
const current = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  return byId.has(id) ? id : 'overview';
};
function markCurrent() {
  const id = current();
  for (const l of document.querySelectorAll('.nav-link')) {
    if (l.dataset.id === id) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  }
}
function show() {
  const id = current();
  const a = byId.get(id);
  // Its group opens in the navigator.
  if (a.dataset.group && !openGroups.has(a.dataset.group)) { openGroups.add(a.dataset.group); renderNav(document.querySelector('.filter').value); }
  for (const x of articles) {
    const on = x === a;
    x.hidden = !on;
    for (const v of x.querySelectorAll('video')) { if (on && v.autoplay) v.play().catch(() => {}); else v.pause(); }
  }
  document.title = id === 'overview' ? 'Lyric Player Documentation' : `${a.dataset.title} | Lyric Player Documentation`;
  crumbs.innerHTML = id === 'overview' ? ''
    : `<span class="sep" aria-hidden="true">›</span><span>${esc(a.dataset.group)}</span><span class="sep" aria-hidden="true">›</span><span>${esc(a.dataset.title)}</span>`;
  markCurrent();
  document.body.classList.remove('nav-open');
  menuBtn.setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
  watchReveals(a);
}
function go() {
  if (document.startViewTransition && !reduced.matches) document.startViewTransition(show);
  else show();
}
addEventListener('hashchange', () => { go(); document.getElementById('content').focus({ preventScroll: true }); });

// Small screens: the navigator slides in over the page.
menuBtn.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  menuBtn.setAttribute('aria-expanded', String(open));
});
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (lightbox) { closeZoom(); return; }
  if (document.body.classList.contains('nav-open')) {
    document.body.classList.remove('nav-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.focus();
  }
});

// ---------------------------------------------------------------------------
// Content rises in as it scrolls into view.

const io = 'IntersectionObserver' in window && !reduced.matches
  ? new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px' })
  : null;
function watchReveals(a) {
  if (!io) return;
  for (const el of a.querySelectorAll('.body > figure, .body > .pair, .body > .aside, .body > table, .body > h2, .body > h3, .topic-group, .highlight')) {
    if (el.classList.contains('in')) continue;
    el.classList.add('reveal');
    io.observe(el);
  }
}

// ---------------------------------------------------------------------------
// Click a screenshot to zoom it; it grows from where it is on the page.

let lightbox = null, zoomFrom = null;
function openZoom(img) {
  const fig = img.closest('figure');
  zoomFrom = img;
  lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.setAttribute('role', 'dialog');
  lightbox.setAttribute('aria-label', img.alt || 'Screenshot');
  lightbox.tabIndex = -1;
  const big = new Image();
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  lightbox.append(big);
  const cap = fig?.querySelector('figcaption');
  if (cap) { const p = document.createElement('p'); p.textContent = cap.textContent; lightbox.append(p); }
  lightbox.addEventListener('click', closeZoom);
  document.body.append(lightbox);
  lightbox.focus();
  requestAnimationFrame(() => {
    lightbox.classList.add('open');
    if (reduced.matches) return;
    const a = img.getBoundingClientRect(), b = big.getBoundingClientRect();
    if (!b.width) return;
    big.animate([
      { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})` },
      { transform: 'none' },
    ], { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  });
}
function closeZoom() {
  if (!lightbox) return;
  const box = lightbox;
  lightbox = null;
  box.classList.remove('open');
  setTimeout(() => box.remove(), 300);
  zoomFrom?.focus?.();
}
document.addEventListener('click', (e) => {
  const img = e.target.closest('main figure img');
  if (img) openZoom(img);
});
document.addEventListener('keydown', (e) => {
  const img = e.target.closest?.('main figure img');
  if (img && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openZoom(img); }
});
for (const img of document.querySelectorAll('main figure img')) {
  img.tabIndex = 0;
  img.setAttribute('role', 'button');
  img.setAttribute('aria-label', `Zoom: ${img.alt}`);
}

// Reduced motion: clips wait for a click instead of playing on their own.
if (reduced.matches) {
  for (const v of document.querySelectorAll('video')) { v.removeAttribute('autoplay'); v.controls = true; }
}

renderNav();
show();
