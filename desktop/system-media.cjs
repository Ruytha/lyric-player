// What's playing on this PC (Spotify, Apple Music, browsers...), read from
// Windows' media controls by a small PowerShell helper (system-media.ps1).
// It runs only while "Follow music playing on this PC" is on.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

class SystemMedia {
  constructor({ onState, log = () => {}, ownAppId = '' }) {
    this.onState = onState;
    this.log = log;
    this.ownAppId = ownAppId;
    this.child = null;
    this.wanted = false;
    this.state = null;
    this.thumbs = new Map(); // track -> data URL (last few)
    this.restarts = 0;
    this.timer = null;
  }

  start() {
    this.wanted = true;
    if (this.child || process.platform !== 'win32') return;
    // The script lives in the app's asar, which PowerShell can't read, so it's
    // passed inline (as UTF-16LE base64, the way -EncodedCommand wants it).
    const script = fs.readFileSync(path.join(__dirname, 'system-media.ps1'), 'utf8');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: { ...process.env, LP_OWN_AUMID: this.ownAppId },
    });
    this.child = child;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) this.line(line);
      }
    });
    child.stderr.on('data', (d) => {
      const t = String(d).trim();
      if (t && !/^#< CLIXML|^<Objs/.test(t)) this.log(`[system-media] ${t.slice(0, 300)}`); // PowerShell's progress records aren't errors
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (!this.wanted) return;
      // Crashed: try again, more slowly each time.
      this.log(`[system-media] helper exited (${code}), restarting`);
      const wait = Math.min(30000, 1000 * 2 ** this.restarts++);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (this.wanted) this.start(); }, wait);
    });
    child.on('error', (e) => this.log(`[system-media] ${e.message}`));
  }

  stop() {
    this.wanted = false;
    clearTimeout(this.timer);
    const c = this.child;
    this.child = null;
    if (c) { try { c.stdin.end(); } catch {} setTimeout(() => { try { c.kill(); } catch {} }, 500); }
    this.state = null;
  }

  line(text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.error) { this.log(`[system-media] ${m.error}`); return; }
    this.restarts = 0;
    if (m.thumbFor !== undefined) {
      if (m.thumb) {
        this.thumbs.set(m.thumbFor, m.thumb);
        while (this.thumbs.size > 4) this.thumbs.delete(this.thumbs.keys().next().value);
      }
      if (this.state && this.state.track === m.thumbFor) this.emit({ ...this.state });
      return;
    }
    this.emit(m);
  }

  emit(s) {
    this.state = s;
    this.onState({ ...s, thumb: (s.track && this.thumbs.get(s.track)) || null });
  }

  command(cmd, value) {
    if (!this.child) return false;
    const ok = ['toggle', 'play', 'pause', 'next', 'prev', 'seek'];
    if (!ok.includes(cmd)) return false;
    const arg = cmd === 'seek' ? ` ${Math.max(0, Number(value) || 0).toFixed(3)}` : '';
    this.child.stdin.write(`${cmd}${arg}\n`);
    return true;
  }
}

module.exports = { SystemMedia };
