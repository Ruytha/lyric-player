// Discord Rich Presence over Discord's local IPC pipe (no dependencies).
//
// Protocol: frames of [op int32 LE][length int32 LE][JSON]. op 0 = handshake
// { v: 1, client_id }, op 1 = command (SET_ACTIVITY), op 2 = close,
// op 3/4 = ping/pong. The Discord desktop app must be running.

const net = require('node:net');
const path = require('node:path');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  return path.join(base, `discord-ipc-${i}`);
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function connectPipe(i = 0) {
  return new Promise((resolve, reject) => {
    if (i > 9) { reject(new Error('Discord is not running')); return; }
    const sock = net.createConnection(pipePath(i));
    sock.once('connect', () => resolve(sock));
    sock.once('error', () => { sock.destroy(); connectPipe(i + 1).then(resolve, reject); });
  });
}

class DiscordPresence {
  constructor({ log = () => {} } = {}) {
    this.log = log;
    this.clientId = null;
    this.sock = null;
    this.ready = false;
    this.connecting = null;
    this.activity = undefined;   // latest wanted activity (null = clear)
    this.sentJson = null;
    this.lastSend = 0;
    this.timer = null;
    this.retryTimer = null;
    this.status = 'off';         // off | connecting | connected | no-discord | error: …
    this.rejected = null;        // application ID Discord refused
    this.buf = Buffer.alloc(0);
  }

  /** Sets (or clears, with null) the activity. Sends are rate-limited. */
  set(clientId, activity) {
    if (!clientId) { this.stop(); return; }
    // An ID Discord rejected stays rejected until it's changed.
    if (clientId === this.rejected) return;
    if (clientId !== this.clientId) { this.disconnect(); this.clientId = clientId; }
    this.activity = activity;
    this.ensure();
    this.schedule();
  }

  stop() {
    if (this.ready && this.sentJson !== 'null') this.write(null);
    this.clientId = null;
    this.activity = undefined;
    this.disconnect();
    this.status = 'off';
  }

  async ensure() {
    if (this.ready || this.connecting || !this.clientId) return;
    const id = this.clientId;
    this.status = 'connecting';
    this.connecting = (async () => {
      try {
        const sock = await connectPipe();
        if (id !== this.clientId) { sock.destroy(); return; }
        this.sock = sock;
        this.buf = Buffer.alloc(0);
        sock.on('data', (d) => this.onData(d));
        sock.on('close', () => this.onClose());
        sock.on('error', () => {});
        sock.write(encode(OP.HANDSHAKE, { v: 1, client_id: id }));
      } catch (e) {
        this.status = 'no-discord';
        this.retryLater();
      } finally {
        this.connecting = null;
      }
    })();
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break;
      let msg = null;
      try { msg = JSON.parse(this.buf.subarray(8, 8 + len).toString('utf8')); } catch { /* ignore */ }
      this.buf = this.buf.subarray(8 + len);
      if (op === OP.PING) this.sock?.write(encode(OP.PONG, msg));
      else if (op === OP.CLOSE) {
        this.status = `error: ${msg?.message || 'Discord closed the connection'}`;
        this.log(`[discord] closed: ${msg?.message || ''} (${msg?.code ?? ''})`);
        this.rejected = this.clientId; // a bad application ID would fail again; wait for a new one
        this.clientId = null;
        this.disconnect();
      } else if (msg?.evt === 'READY') {
        this.ready = true;
        this.status = 'connected';
        this.sentJson = null;
        this.schedule();
      } else if (msg?.evt === 'ERROR') {
        this.status = `error: ${msg.data?.message || 'unknown'}`;
        this.log(`[discord] error: ${msg.data?.message}`);
      }
    }
  }

  onClose() {
    const had = !!this.sock;
    this.sock = null;
    this.ready = false;
    if (had && this.clientId) { this.status = 'no-discord'; this.retryLater(); }
  }

  retryLater() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.ensure(), 15000);
  }

  disconnect() {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = null;
    const s = this.sock;
    this.sock = null;
    this.ready = false;
    this.sentJson = null;
    s?.destroy();
  }

  // Discord allows about 5 updates per 20 s; keep at least 4 s between sends
  // and always send the latest wanted state.
  schedule() {
    if (!this.ready || this.timer) return;
    const wait = Math.max(0, this.lastSend + 4000 - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.ready || this.activity === undefined) return;
      const json = JSON.stringify(this.activity);
      if (json === this.sentJson) return;
      this.write(this.activity);
    }, wait);
  }

  write(activity) {
    this.sentJson = JSON.stringify(activity);
    this.lastSend = Date.now();
    this.sock?.write(encode(OP.FRAME, {
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }));
  }
}

module.exports = { DiscordPresence };
