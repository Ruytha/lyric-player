// Diagnostics: keeps the last errors and notable events so "Copy diagnostics"
// (Settings → About) can produce a report that's quick to act on.

const MAX = 120;
const log = [];

function push(level, text) {
  log.push({ t: new Date().toISOString().slice(11, 19), level, text: String(text).slice(0, 600) });
  if (log.length > MAX) log.shift();
}

export const diagnostics = {
  note(text) { push('info', text); },
  error(context, e) { push('error', `${context}: ${e?.stack?.split('\n').slice(0, 3).join(' | ') || e?.message || e}`); },
  entries: () => log.slice(),
  /** Builds the report. extra: { settings, sources, app } */
  report({ settings = {}, sources = null, app = null } = {}) {
    const hide = new Set(['lastfmSecret']);
    const s = Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, hide.has(k) && v ? '(set)' : v]));
    const lines = [
      'Lyric Player diagnostics',
      `Time: ${new Date().toISOString()}`,
      app ? `App: ${app.app} · Electron ${app.electron} · Chrome ${app.chrome} · ${app.os}` : `Website · ${navigator.userAgent}`,
      app ? `GPU: ${JSON.stringify(app.gpu)} · music folders: ${app.musicFolders}` : '',
      `Screen: ${innerWidth}×${innerHeight} @${devicePixelRatio}x · WebGL: ${!!document.createElement('canvas').getContext('webgl2')}`,
      '',
      'Settings:',
      JSON.stringify(s),
    ];
    if (sources) {
      lines.push('', 'Sources:');
      for (const r of sources) lines.push(`  ${r.ok ? 'OK  ' : r.skipped ? 'SKIP' : 'FAIL'} ${r.name}${r.ms != null ? ` (${r.ms} ms)` : ''}${r.detail ? ` — ${r.detail}` : ''}`);
    }
    lines.push('', 'Recent events:');
    for (const e of log.slice(-60)) lines.push(`  ${e.t} ${e.level === 'error' ? 'ERR ' : '    '}${e.text}`);
    return lines.filter((l) => l !== null).join('\n');
  },
};

addEventListener('error', (e) => diagnostics.error('page', e.error || e.message));
addEventListener('unhandledrejection', (e) => diagnostics.error('promise', e.reason));
