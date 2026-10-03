// Phone remote (Settings → Phone remote): a small web server on your home
// network. Your phone opens http://<this PC>:<port>/?t=<code> and sees the
// song, the line being sung and play / next / previous / seek buttons.
//
// Only requests with the code are answered; the code is random, saved in the
// app's settings, and can be changed (which disconnects old phones). The
// remote page itself (src/remote.js + src/remote.css) comes from the player's
// files, so it updates with in-app updates.

const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#111318">
<meta name="apple-mobile-web-app-capable" content="yes">
<title>Lyric Player remote</title>
<link rel="stylesheet" href="/src/remote.css">
</head><body><div id="remote"></div><script type="module" src="/src/remote.js"></script></body></html>`;

const COMMANDS = new Set(['toggle', 'next', 'prev', 'seek', 'bar', 'volume']);

class RemoteServer {
  constructor({ getRoot, onCommand, log = () => {} }) {
    this.getRoot = getRoot;
    this.onCommand = onCommand;
    this.log = log;
    this.server = null;
    this.port = 0;
    this.token = '';
    this.state = null;
    this.art = null; // { type, data: Buffer }
    this.clients = new Set();
  }

  static newToken() { return crypto.randomBytes(9).toString('base64url'); }

  get running() { return !!this.server; }

  /** Addresses a phone on the same network can open. */
  urls() {
    if (!this.server) return [];
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) {
        if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(`http://${a.address}:${this.port}/?t=${this.token}`);
      }
    }
    // Home networks first (192.168 / 10 / 172.16-31), virtual adapters last.
    const rank = (u) => (/\/\/192\.168\./.test(u) ? 0 : /\/\/10\./.test(u) ? 1 : /\/\/172\.(1[6-9]|2\d|3[01])\./.test(u) ? 2 : 3);
    return out.sort((a, b) => rank(a) - rank(b));
  }

  async start(token, port = 7781) {
    this.token = token;
    if (this.server) return true;
    for (let p = port; p < port + 10; p++) {
      const ok = await new Promise((resolve) => {
        const s = http.createServer((req, res) => this.handle(req, res));
        s.once('error', () => resolve(false));
        s.listen(p, '0.0.0.0', () => { this.server = s; this.port = p; resolve(true); });
      });
      if (ok) { this.log(`[remote] listening on ${this.port}`); return true; }
    }
    return false;
  }

  stop() {
    for (const c of this.clients) c.end();
    this.clients.clear();
    this.server?.close();
    this.server = null;
  }

  setToken(token) {
    this.token = token;
    for (const c of this.clients) c.end(); // phones with the old code are cut off
    this.clients.clear();
  }

  /** What's playing, from the player window (a few times a second). */
  setState(s) {
    const { art, ...rest } = s || {};
    if (typeof art === 'string' && art.startsWith('data:image/')) {
      const m = /^data:(image\/[\w+.-]+);base64,(.*)$/.exec(art);
      if (m && m[2].length < 2_000_000) this.art = { type: m[1], data: Buffer.from(m[2], 'base64'), key: crypto.createHash('sha1').update(m[2]).digest('hex').slice(0, 12) };
    } else if (art === null) this.art = null;
    this.state = { ...rest, art: this.art ? `/api/art?t=${this.token}&k=${this.art.key}` : null };
    const msg = `data: ${JSON.stringify(this.state)}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  authorized(url) {
    const t = url.searchParams.get('t') || '';
    const a = Buffer.from(t), b = Buffer.from(this.token);
    return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
  }

  handle(req, res) {
    let url;
    try { url = new URL(req.url, 'http://remote'); } catch { res.writeHead(400).end(); return; }
    const send = (code, type, body, extra = {}) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', ...extra });
      res.end(body);
    };
    // The page's own files need no code (they hold nothing private).
    if (req.method === 'GET' && (url.pathname === '/src/remote.js' || url.pathname === '/src/remote.css')) {
      fs.readFile(path.join(this.getRoot(), 'src', path.basename(url.pathname)), (err, data) => {
        if (err) send(404, 'text/plain', 'Not found');
        else send(200, url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8', data);
      });
      return;
    }
    if (!this.authorized(url)) { send(403, 'text/plain; charset=utf-8', 'This remote link is out of date. Open Settings → Phone remote in Lyric Player and scan the code again.'); return; }
    if (req.method === 'GET' && url.pathname === '/') { send(200, 'text/html; charset=utf-8', PAGE); return; }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`retry: 2000\n\n`);
      if (this.state) res.write(`data: ${JSON.stringify(this.state)}\n\n`);
      this.clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(ping); this.clients.delete(res); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/art') {
      if (!this.art) send(404, 'text/plain', 'No cover');
      else send(200, this.art.type, this.art.data, { 'cache-control': 'private, max-age=86400' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/cmd') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 2000) req.destroy(); });
      req.on('end', () => {
        try {
          const { cmd, value } = JSON.parse(body || '{}');
          if (!COMMANDS.has(cmd)) { send(400, 'text/plain', 'Unknown command'); return; }
          this.onCommand({ cmd, value: Number.isFinite(value) ? value : undefined });
          send(200, 'application/json', '{"ok":true}');
        } catch { send(400, 'text/plain', 'Bad request'); }
      });
      return;
    }
    send(404, 'text/plain', 'Not found');
  }
}

module.exports = { RemoteServer };
