// Credits: who made Lyric Player, and the projects and lyric sources it uses.

const MADE_WITH = [
  ['AMLL', 'https://github.com/amll-dev/applemusic-like-lyrics', 'Lyric player engine and mesh background (AGPL-3.0)'],
  ['Lyricify Backgrounds', 'https://github.com/WXRIW/Lyricify-Backgrounds', 'Moving background by WXRIW (Apache 2.0)'],
  ['Electron', 'https://www.electronjs.org', 'The Windows and Mac app'],
  ['Capacitor', 'https://capacitorjs.com', 'The iPhone app'],
];
const LYRICS_FROM = [
  ['Apple Music', 'https://music.apple.com'],
  ['AMLL TTML DB', 'https://github.com/amll-dev/amll-ttml-db'],
  ['BiniLyrics', null],
  ['NetEase Cloud Music', 'https://music.163.com'],
  ['QQ Music', 'https://y.qq.com'],
  ['LRCLIB', 'https://lrclib.net'],
  ['MusicBrainz (songwriters)', 'https://musicbrainz.org'],
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const link = (name, url) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name));

export function showCredits() {
  document.getElementById('creditsDialog')?.remove();
  const root = document.createElement('div');
  root.className = 'lyric-search whats-new credits';
  root.id = 'creditsDialog';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Credits');
  root.innerHTML = `
    <div class="ls-panel wn-panel">
      <div class="card-head">
        <h2>Credits</h2>
        <button class="sheet-btn sheet-close" data-close type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <div class="wn-body">
        <div class="cr-maker">
          <img src="${new URL('./assets/ruytha.png', import.meta.url)}" alt="Ruytha" width="96" height="96">
          <div>
            <div class="cr-name">Ruytha</div>
            <div class="cr-role">Made Lyric Player</div>
            <a class="cr-site" href="https://ruytha.dev" target="_blank" rel="noopener">ruytha.dev</a>
          </div>
        </div>
        <section>
          <h3>Made with</h3>
          <ul>${MADE_WITH.map(([n, u, what]) => `<li>${link(n, u)} <span>${esc(what)}</span></li>`).join('')}</ul>
        </section>
        <section>
          <h3>Lyrics from</h3>
          <ul>${LYRICS_FROM.map(([n, u]) => `<li>${link(n, u)}</li>`).join('')}</ul>
          <p class="cr-note">Lyrics belong to their songwriters and publishers. Songwriters are shown after the last line when the lyrics include them.</p>
        </section>
      </div>
      <div class="acct-buttons wn-foot"><button class="pill pill-small" data-close type="button">Done</button></div>
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
