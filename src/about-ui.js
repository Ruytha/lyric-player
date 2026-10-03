// Settings rows built by hand: About (version, updates, source check,
// diagnostics) and the Last.fm account.

import { diagnostics } from './diagnostics.js';
import { checkSources, SOURCES } from './source-check.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const native = () => (typeof window !== 'undefined' ? window.lyricPlayerNative : null);
const unwrap = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

let lastSources = null;

/** Where in-app updates come from (Ruytha's update site unless you set your own). */
export const UPDATE_SITE = 'https://files.ruytha.dev/update/lyricviewer';
export const updateSite = (settings) => (settings.get('site') || '').trim() || UPDATE_SITE;

export function buildAboutRow(row, { settings, toast }) {
  const n = native();
  row.classList.add('about');
  row.innerHTML = `
    <div class="set-head"><span class="set-label">Lyric Player <span class="about-version"></span></span><span class="acct-state">Made by Ruytha</span></div>
    ${n?.update ? '<div class="about-update"><span class="update-state">Updates</span><button type="button" class="pill pill-small pill-ghost" data-update>Check for updates</button></div>' : ''}
    <div class="acct-buttons">
      <button type="button" class="pill pill-small" data-check>Check sources</button>
      <button type="button" class="pill pill-small pill-ghost" data-copy>Copy diagnostics</button>
    </div>
    <div class="source-list" hidden></div>
    <div class="set-hint">Check sources tries each lyrics and cover source once. Copy diagnostics copies a report (versions, settings without secrets, recent errors) to paste when something is wrong.</div>`;

  const version = row.querySelector('.about-version');
  if (n?.update) n.update('version').then((v) => { version.textContent = v; }).catch(() => {});

  // Updates
  const stateEl = row.querySelector('.update-state');
  const btn = row.querySelector('[data-update]');
  const showUpdate = (s) => {
    if (!stateEl || !s) return;
    const text = {
      idle: 'Updates', checking: 'Checking for updates…', none: 'You have the latest version',
      available: `Version ${s.version} is available`, downloading: `Downloading… ${s.percent ?? 0}%`,
      ready: `Version ${s.version} is ready`, error: `Update check failed: ${s.message || ''}`,
      'not-configured': 'Add your website below to get updates', dev: 'Updates work in the installed app',
      'needs-app': `Version ${s.version} needs the new installer (app ${s.minApp} or later)`,
    }[s.state] || 'Updates';
    stateEl.textContent = s.state === 'ready' && s.kind === 'web' ? `Version ${s.version} is ready (used from the next start)` : text;
    btn.hidden = ['checking', 'downloading', 'dev'].includes(s.state);
    btn.textContent = s.state === 'available' ? 'Download' : s.state === 'ready' ? (s.kind === 'web' ? 'Use it now' : 'Restart to update') : 'Check for updates';
    btn.dataset.next = s.state === 'available' ? 'download' : s.state === 'ready' ? 'install' : 'check';
  };
  if (n?.update) {
    n.onUpdateStatus?.((s) => {
      showUpdate(s);
      if (s.state === 'ready') toast(s.kind === 'web' ? `Version ${s.version} downloaded. It’s used from the next start (or Settings → About → Use it now)` : `Update ${s.version} downloaded. It installs when you restart`, { ms: 6000 });
    });
    n.update('status').then(showUpdate).catch(() => {});
    btn.addEventListener('click', () => n.update(btn.dataset.next || 'check', { site: updateSite(settings) }).then(showUpdate).catch((e) => showUpdate({ state: 'error', message: unwrap(e) })));
  }

  // Sources
  const list = row.querySelector('.source-list');
  row.querySelector('[data-check]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    list.hidden = false;
    list.innerHTML = SOURCES.map(([name], i) => `<div class="src-row" data-i="${i}"><span class="src-dot wait"></span><span class="src-name">${esc(name)}</span><span class="src-detail">checking…</span></div>`).join('');
    lastSources = await checkSources((r, i) => {
      const el = list.querySelector(`[data-i="${i}"]`);
      el.querySelector('.src-dot').className = `src-dot ${r.ok ? 'ok' : r.skipped ? 'skip' : 'fail'}`;
      el.querySelector('.src-detail').textContent = r.skipped ? r.detail : r.ok ? `${r.ms} ms` : r.detail;
    });
    for (const r of lastSources) if (!r.ok && !r.skipped) diagnostics.note(`source check failed: ${r.name} — ${r.detail}`);
    b.disabled = false;
  });

  // Diagnostics
  row.querySelector('[data-copy]').addEventListener('click', async () => {
    const app = await n?.diagnostics?.().catch(() => null);
    const text = diagnostics.report({ settings: settings.values, sources: lastSources, app });
    try {
      if (n?.diagnostics) await n.diagnostics(text);
      else await navigator.clipboard.writeText(text);
      toast('Diagnostics copied. Paste them in a message');
    } catch {
      toast('Couldn’t copy to the clipboard', { error: true });
    }
  });
}

export function buildLastfmRow(row, { settings, toast }) {
  const n = native();
  row.classList.add('acct');
  row.innerHTML = `
    <div class="set-head"><span class="set-label">Account</span><span class="acct-state" role="status">Not connected</span></div>
    <div class="acct-buttons">
      <button type="button" class="pill pill-small" data-connect>Connect to Last.fm…</button>
      <button type="button" class="pill pill-small pill-ghost" data-disconnect hidden>Disconnect</button>
    </div>
    <div class="set-hint">Make a free API account at last.fm/api/account/create (any name, no callback URL), paste its API key and shared secret below, then Connect. Last.fm opens in your browser to approve it.</div>`;
  const stateEl = row.querySelector('.acct-state');
  const connect = row.querySelector('[data-connect]');
  const disconnect = row.querySelector('[data-disconnect]');
  const keys = () => ({ apiKey: String(settings.get('lastfmKey') || '').trim(), secret: String(settings.get('lastfmSecret') || '').trim() });
  const show = (s, note) => {
    stateEl.textContent = note || (s?.connected ? `Connected as ${s.name}` : 'Not connected');
    connect.hidden = !!s?.connected;
    disconnect.hidden = !s?.connected;
  };
  n.lastfm('status', keys()).then((s) => show(s)).catch(() => {});
  connect.addEventListener('click', async () => {
    connect.disabled = true;
    show(null, 'Approve the app in your browser…');
    try {
      const s = await n.lastfm('connect', keys());
      show(s);
      toast(`Connected to Last.fm as ${s.name}`);
      if (!settings.get('lastfm')) settings.set('lastfm', true);
    } catch (e) {
      show(null, unwrap(e));
    } finally {
      connect.disabled = false;
    }
  });
  disconnect.addEventListener('click', async () => {
    show(await n.lastfm('disconnect').catch(() => null));
  });
}
