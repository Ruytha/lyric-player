// Documentation: one article at a time (by #id), a topic sidebar built from the
// articles themselves, a filter, and topic lists for the overview and "See also".

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

const ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L12.5 4.5v10h-8.5z"/><path d="M9.5 1.5v3h3M6 8h4.5M6 10.5h4.5"/></svg>';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const link = (a) => `<a href="#${a.dataset.id}" data-id="${a.dataset.id}">${ICON}<span>${esc(a.dataset.title)}</span></a>`;

// Sidebar
const nav = document.getElementById('navList');
function renderNav(filter = '') {
  const q = filter.trim().toLowerCase();
  const match = (a) => !q || `${a.dataset.title} ${a.dataset.abstract || ''} ${a.textContent}`.toLowerCase().includes(q);
  const html = [`<a href="#overview" data-id="overview">${ICON}<span>Overview</span></a>`];
  let any = false;
  for (const g of groups) {
    const items = g.items.filter(match);
    if (!items.length) continue;
    any = true;
    html.push(`<h2>${esc(g.name)}</h2>`, ...items.map(link));
  }
  if (!any) html.push('<p class="empty">No topics match.</p>');
  nav.innerHTML = html.join('');
  markCurrent();
}
document.querySelector('.filter').addEventListener('input', (e) => renderNav(e.target.value));

// Topic lists: the overview lists every group; "See also" lists named articles.
const topicRow = (a) => `<a href="#${a.dataset.id}">${esc(a.dataset.title)}</a><p>${esc(a.dataset.abstract || '')}</p>`;
document.getElementById('overviewTopics').innerHTML = groups
  .map((g) => `<div class="topic-group"><h4>${esc(g.name)}</h4><div class="topic-links">${g.items.map(topicRow).join('')}</div></div>`)
  .join('');
for (const box of document.querySelectorAll('[data-see]')) {
  const items = box.dataset.see.split(/\s+/).map((id) => byId.get(id)).filter(Boolean);
  box.innerHTML = `<div class="topic-group"><h4>Related</h4><div class="topic-links">${items.map(topicRow).join('')}</div></div>`;
}

// Breadcrumbs
for (const a of articles) {
  if (a.dataset.id === 'overview') continue;
  const crumbs = document.createElement('nav');
  crumbs.className = 'crumbs';
  crumbs.setAttribute('aria-label', 'Breadcrumb');
  crumbs.innerHTML = `<a href="#overview">Lyric Player</a><span aria-hidden="true">›</span><span>${esc(a.dataset.group)}</span>`;
  a.prepend(crumbs);
}

// Routing
function markCurrent() {
  const id = current();
  for (const l of nav.querySelectorAll('a')) {
    if (l.dataset.id === id) l.setAttribute('aria-current', 'page');
    else l.removeAttribute('aria-current');
  }
}
const current = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  return byId.has(id) ? id : 'overview';
};
function show() {
  const id = current();
  for (const a of articles) {
    const on = a.dataset.id === id;
    a.hidden = !on;
    // Clips only play on the visible article.
    for (const v of a.querySelectorAll('video')) { if (on && v.autoplay) v.play().catch(() => {}); else v.pause(); }
  }
  const a = byId.get(id);
  document.title = id === 'overview' ? 'Lyric Player Documentation' : `${a.dataset.title} | Lyric Player Documentation`;
  markCurrent();
  document.body.classList.remove('nav-open');
  menuBtn.setAttribute('aria-expanded', 'false');
  window.scrollTo(0, 0);
}
addEventListener('hashchange', () => { show(); document.getElementById('content').focus({ preventScroll: true }); });

// Small screens: the sidebar opens over the page.
const menuBtn = document.querySelector('.menu-btn');
menuBtn.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  menuBtn.setAttribute('aria-expanded', String(open));
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
    document.body.classList.remove('nav-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.focus();
  }
});

// Respect reduced motion: clips wait for a click instead of playing on their own.
if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const v of document.querySelectorAll('video')) { v.removeAttribute('autoplay'); v.controls = true; }
}

renderNav();
show();
