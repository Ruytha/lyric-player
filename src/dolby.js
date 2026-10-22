// Chromium (Chrome, the desktop app, Android's WebView) can't decode Dolby
// Digital Plus / Dolby Atmos, so those songs are converted to stereo WAV with
// ffmpeg compiled to WebAssembly, in a worker so the lyrics keep moving.
// The decoder (about 31 MB) is downloaded the first time it's needed, then cached.

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core';

// Atmos mixes sit around -18 LUFS and the stereo fold-down drops them further,
// so they'd play far quieter than stereo masters. Aim near -10 LUFS and let the
// limiter take at most 3 dB off the loudest peaks.
const TARGET_LUFS = -10;

/** ffmpeg's ebur128 summary → dB to add (0 when it couldn't be read). */
export function loudnessGain(log) {
  const lufs = Number(/\bI:\s+(-?[\d.]+) LUFS/.exec(log)?.[1]);
  const peak = Number(/\bPeak:\s+(-?[\d.]+) dBFS/.exec(log)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) return 0;
  return Math.round(Math.max(0, Math.min(TARGET_LUFS - lufs, 2 - peak)) * 10) / 10;
}

const WORKER = `
importScripts('${CORE}.js');
const loudnessGain = ${loudnessGain};
const TARGET_LUFS = ${TARGET_LUFS};
let core, log = [];
const run = (...args) => {
  log = [];
  core.reset();
  const ret = core.exec(...args);
  if (ret !== 0) throw new Error(log.filter((l) => /error|invalid|not/i.test(l)).pop() || 'ffmpeg exited ' + ret);
  return log.join('\\n');
};
onmessage = async ({ data }) => {
  try {
    if (!core) {
      core = await createFFmpegCore({ mainScriptUrlOrBlob: '${CORE}.js#' + btoa(JSON.stringify({ wasmURL: '${CORE}.wasm' })) });
      core.setLogger(({ message }) => { log.push(message); if (log.length > 200) log.shift(); });
    }
    core.FS.writeFile('in', new Uint8Array(data));
    // The Atmos objects are dropped; the 5.1 bed is mixed down to stereo first, then measured.
    const stereo = 'aformat=channel_layouts=stereo';
    const info = run('-i', 'in', '-vn', '-af', stereo + ',ebur128=peak=true:framelog=verbose', '-f', 'null', '-');
    const gain = loudnessGain(info);
    run('-i', 'in', '-vn', '-af', stereo + ',volume=' + gain.toFixed(1) + 'dB,alimiter=limit=0.89:level=false', '-c:a', 'pcm_s16le', '-f', 'wav', 'out.wav');
    core.FS.unlink('in');
    const out = core.FS.readFile('out.wav');
    core.FS.unlink('out.wav');
    postMessage({ wav: out }, [out.buffer]);
  } catch (e) {
    try { core?.FS.unlink('in'); } catch { /* not written */ }
    postMessage({ error: e.message || String(e) });
  }
};`;

let worker = null;

/** True when the bytes hold Dolby Digital (Plus) audio: an MP4 'ec-3'/'ac-3' track or a raw stream. */
export function isDolby(bytes, name = '') {
  if (/\.(ec3|eac3|ac3)$/i.test(name)) return true;
  // shortcut: a byte search, not an MP4 box parse; a stray match only costs a failed conversion of a file that already couldn't play.
  const s = new TextDecoder('latin1').decode(bytes);
  return s.includes('ec-3') || s.includes('ac-3');
}

/**
 * True for an Atmos (E-AC-3 JOC) track in an MP4: its 'dec3' box ends with the
 * flag_ec3_extension_type_a bit (ETSI TS 102 366 F.6). ffmpeg 5.1 doesn't report it.
 */
export function isAtmos(bytes) {
  const i = new TextDecoder('latin1').decode(bytes).indexOf('dec3');
  if (i < 4) return false;
  const size = ((bytes[i - 4] << 24) | (bytes[i - 3] << 16) | (bytes[i - 2] << 8) | bytes[i - 1]) >>> 0;
  const p = bytes.subarray(i + 4, i - 4 + size);
  let bit = 0;
  const read = (n) => { let v = 0; while (n--) { v = (v << 1) | ((p[bit >> 3] >> (7 - (bit & 7))) & 1); bit++; } return v; };
  read(13); // data_rate
  const subs = read(3) + 1;
  for (let k = 0; k < subs; k++) {
    read(19); // fscod … reserved
    read(read(4) ? 9 : 1); // chan_loc or reserved
  }
  if (p.length * 8 < bit + 16) return false;
  read(7);
  return read(1) === 1;
}

/** Dolby audio file bytes → a stereo WAV Blob. One conversion at a time. */
export function dolbyToWav(bytes) {
  worker ??= new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(new Blob([data.wav], { type: 'audio/wav' })));
    worker.onerror = (e) => { worker = null; reject(new Error(e.message || 'the decoder couldn’t load')); };
    worker.postMessage(bytes, [bytes]);
  });
}
