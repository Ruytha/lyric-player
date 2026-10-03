// "What's new": after an update, the notes for the versions since the one
// you last saw (src/changelog.json, newest first). Nothing on a first start.

const SEEN = 'lyricplayer:seenVersion';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function compare(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

async function loadChangelog() {
  const r = await fetch(new URL('./changelog.json', import.meta.url), { cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Entries newer than `since` (all of them when forced). */
export function entriesSince(log, since) {
  return since ? log.filter((e) => compare(e.version, since) > 0) : log.slice(0, 1);
}

/** Shows the dialog after an update (or always, with force). */
export async function showWhatsNew({ force = false } = {}) {
  const log = await loadChangelog();
  const current = log[0]?.version;
  if (!current) return;
  let seen = null;
  try {
    seen = localStorage.getItem(SEEN);
    // Updated from a version before this dialog existed (it has settings saved).
    if (!seen && localStorage.getItem('lyricplayer:settings')) seen = log[1]?.version || null;
    localStorage.setItem(SEEN, current);
  } catch { /* storage unavailable */ }
  if (!force && (!seen || compare(current, seen) <= 0)) return; // first start, or nothing new
  const entries = force ? log.slice(0, 3) : entriesSince(log, seen).slice(0, 5);
  if (!entries.length) return;

  document.getElementById('whatsNew')?.remove();
  const root = document.createElement('div');
  root.className = 'lyric-search whats-new';
  root.id = 'whatsNew';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', "What's new");
  root.innerHTML = `
    <div class="ls-panel wn-panel">
      <div class="card-head">
        <h2>What’s new${force ? '' : ` in ${esc(current)}`}</h2>
        <button class="sheet-btn sheet-close" data-close type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="wn-body">${entries.map((e) => `
        <section>
          <h3>${esc(e.version)}${e.date ? `<span>${esc(new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))}</span>` : ''}</h3>
          <ul>${e.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </section>`).join('')}
      </div>
      <div class="acct-buttons wn-foot"><button class="pill pill-small" data-close type="button">Continue</button></div>
    </div>`;
  document.body.appendChild(root);
  const close = () => {
    root.classList.remove('open');
    setTimeout(() => root.remove(), 250);
  };
  for (const b of root.querySelectorAll('[data-close]')) b.addEventListener('click', close);
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  requestAnimationFrame(() => { root.classList.add('open'); root.querySelector('.pill[data-close]').focus(); });
}
