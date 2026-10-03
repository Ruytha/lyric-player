// In-app updates of the player itself (HTML, CSS, JavaScript) from your
// deployed Lyric Player website, without reinstalling the app.
//
// The site's /api/app-update lists every player file with its SHA-256 and the
// version (root package.json). A newer version is downloaded into the app's
// data folder (only files that changed; each one checked against its hash)
// and used from the next start. If an update doesn't start properly, the app
// goes back to the version it was installed with and skips that update.
//
// Changes to the desktop shell itself (main.cjs, preload.cjs) still need a
// new installer; the site says which app version an update needs (minApp).

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// Only these may be written (no "..", no other folders).
const ALLOWED = /^(index\.html|styles\.css|apple-ui\.css|mini\.html|package\.json|(src|examples)\/[\w.\-/]+\.(js|mjs|css|json|ttml|wasm|svg|png))$/;

function compare(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

class WebUpdate {
  constructor({ bundledRoot, dataDir, appVersion, log = () => {} }) {
    this.bundledRoot = bundledRoot;
    this.dir = path.join(dataDir, 'web-update');
    this.current = path.join(this.dir, 'current');
    this.appVersion = appVersion;
    this.log = log;
    this.busy = null;
    this.root = this.pickRoot();
  }

  bundledVersion() { return readJson(path.join(this.bundledRoot, 'package.json'))?.version || '0.0.0'; }

  /** The downloaded update, if it's newer than the installed files, works with this app and isn't marked bad. */
  pickRoot() {
    const info = readJson(path.join(this.current, 'update.json'));
    const bad = readJson(path.join(this.dir, 'bad.json'));
    if (info && compare(info.version, this.bundledVersion()) > 0 && compare(this.appVersion, info.minApp) >= 0
        && bad?.version !== info.version && fs.existsSync(path.join(this.current, 'index.html'))) {
      return this.current;
    }
    return this.bundledRoot;
  }

  get usingUpdate() { return this.root === this.current; }

  version() { return readJson(path.join(this.root, 'package.json'))?.version || '0.0.0'; }

  /** Called when an update failed to start: go back to the installed files and skip it. */
  markBad() {
    if (!this.usingUpdate) return false;
    const v = this.version();
    try { fs.writeFileSync(path.join(this.dir, 'bad.json'), JSON.stringify({ version: v, at: Date.now() })); } catch { /* ignore */ }
    this.log(`[web-update] ${v} didn't start; using the installed version`);
    this.root = this.bundledRoot;
    return true;
  }

  async manifest(site) {
    const base = String(site || '').trim().replace(/\/+$/, '');
    // https only (a local http address is allowed for testing).
    if (!/^https:\/\/[^\s/]+/i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(base)) throw new Error('set your website (https://…) in Settings → About');
    const r = await fetch(`${base}/api/app-update`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? 'your website doesn’t have the update service yet (redeploy it)' : `website said HTTP ${r.status}`);
    const m = await r.json();
    if (!m?.version || !m.files || typeof m.files !== 'object') throw new Error('unexpected answer from your website');
    return { ...m, base };
  }

  /** { state: 'none' | 'available' | 'needs-app', version, minApp } */
  async check(site) {
    const m = await this.manifest(site);
    const bad = readJson(path.join(this.dir, 'bad.json'));
    const pending = readJson(path.join(this.current, 'update.json'));
    if (compare(m.version, this.version()) <= 0 || bad?.version === m.version) return { state: 'none', version: this.version() };
    if (compare(this.appVersion, m.minApp) < 0) return { state: 'needs-app', version: m.version, minApp: m.minApp };
    if (pending?.version === m.version && !this.usingUpdate) return { state: 'ready', version: m.version };
    return { state: 'available', version: m.version, manifest: m };
  }

  /** Downloads an update; it's used from the next start (or reload). */
  download(m, onProgress = () => {}) {
    this.busy ??= this.doDownload(m, onProgress).finally(() => { this.busy = null; });
    return this.busy;
  }

  async doDownload(m, onProgress) {
    const entries = Object.entries(m.files);
    for (const [p, h] of entries) {
      if (!ALLOWED.test(p) || p.includes('..') || !/^[0-9a-f]{64}$/.test(h)) throw new Error(`unexpected file in the update: ${p}`);
    }
    const staging = path.join(this.dir, 'staging');
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging, { recursive: true });
    let done = 0;
    for (const [p, hash] of entries) {
      const dest = path.join(staging, ...p.split('/'));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      // Unchanged files are copied from what's in use; the rest downloaded.
      let data = null;
      try {
        const local = await fsp.readFile(path.join(this.root, ...p.split('/')));
        if (sha256(local) === hash) data = local;
      } catch { /* not there */ }
      if (!data) {
        const r = await fetch(`${m.base}/${p.split('/').map(encodeURIComponent).join('/')}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`couldn’t download ${p} (HTTP ${r.status})`);
        data = Buffer.from(await r.arrayBuffer());
        if (sha256(data) !== hash) throw new Error(`${p} didn’t match its checksum; try again after the website finishes deploying`);
      }
      await fsp.writeFile(dest, data);
      onProgress(Math.round((++done / entries.length) * 100));
    }
    await fsp.writeFile(path.join(staging, 'update.json'), JSON.stringify({ version: m.version, minApp: m.minApp || '0.0.0', from: m.base, at: Date.now() }));
    // Swap in: current → old, staging → current.
    const old = path.join(this.dir, 'old');
    await fsp.rm(old, { recursive: true, force: true });
    if (fs.existsSync(this.current)) {
      if (this.usingUpdate) {
        // Files in use can't be moved away on Windows while the page reads
        // them, so copy over instead.
        await fsp.cp(staging, this.current, { recursive: true, force: true });
        await fsp.rm(staging, { recursive: true, force: true });
      } else {
        await fsp.rename(this.current, old);
        await fsp.rename(staging, this.current);
        await fsp.rm(old, { recursive: true, force: true });
      }
    } else {
      await fsp.rename(staging, this.current);
    }
    this.log(`[web-update] ${m.version} downloaded`);
    return { state: 'ready', version: m.version };
  }

  /** Use the downloaded version now (the page is reloaded after this). */
  apply() {
    this.root = this.pickRoot();
    return this.usingUpdate;
  }
}

module.exports = { WebUpdate, compare, ALLOWED };
