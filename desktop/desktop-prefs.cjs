// Settings the app itself needs before the page loads (tray, start with
// Windows, where the floating lyrics sit), in the app's data folder.

const fs = require('node:fs');

class DesktopPrefs {
  constructor(file) {
    this.file = file;
    try { this.values = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { this.values = {}; }
    this.timer = null;
  }

  get(key) { return this.values[key]; }

  set(key, value) {
    if (JSON.stringify(this.values[key]) === JSON.stringify(value)) return;
    this.values[key] = value;
    // Window moves come in bursts; write once they settle.
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try { fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2)); } catch { /* read-only or gone */ }
  }
}

module.exports = { DesktopPrefs };
