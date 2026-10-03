// Red / yellow / green window buttons, like macOS (desktop app). The window
// has no title bar; these call the main process (relayWindowControls).

export function bindWindowControls({ onFullscreen }) {
  const n = window.lyricPlayerNative;
  const host = document.getElementById('winControls');
  if (!n?.windowControl || !host) return;
  host.hidden = false;
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-win]');
    if (!b) return;
    const kind = b.dataset.win;
    // Green: full screen, like macOS (Alt+click maximizes instead).
    if (kind === 'zoom' && !e.altKey) { onFullscreen(); return; }
    n.windowControl(kind).catch(() => {});
  });
  n.onWindowState?.((s) => {
    document.documentElement.classList.toggle('win-blurred', !s.focused);
    document.documentElement.classList.toggle('win-max', !!s.maximized);
  });
}
