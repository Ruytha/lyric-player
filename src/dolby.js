// Chromium (Chrome, the desktop app, Android's WebView) can't decode Dolby
// Digital Plus / Dolby Atmos, so those songs are converted to stereo WAV with
// ffmpeg compiled to WebAssembly, in a worker so the lyrics keep moving.
// The decoder (about 31 MB) is downloaded the first time it's needed, then cached.

const CORE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core';

const WORKER = `
importScripts('${CORE}.js');
let core, log = [];
onmessage = async ({ data }) => {
  try {
    if (!core) {
      core = await createFFmpegCore({ mainScriptUrlOrBlob: '${CORE}.js#' + btoa(JSON.stringify({ wasmURL: '${CORE}.wasm' })) });
      core.setLogger(({ message }) => { log.push(message); if (log.length > 20) log.shift(); });
    }
    core.FS.writeFile('in', new Uint8Array(data));
    core.reset();
    // The Atmos objects are dropped; the 5.1 bed is mixed down to stereo.
    const ret = core.exec('-i', 'in', '-vn', '-ac', '2', '-c:a', 'pcm_s16le', '-f', 'wav', 'out.wav');
    core.FS.unlink('in');
    if (ret !== 0) throw new Error(log.filter((l) => /error|invalid|not/i.test(l)).pop() || 'ffmpeg exited ' + ret);
    const out = core.FS.readFile('out.wav');
    core.FS.unlink('out.wav');
    postMessage({ wav: out }, [out.buffer]);
  } catch (e) {
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

/** Dolby audio file bytes → a stereo WAV Blob. One conversion at a time. */
export function dolbyToWav(bytes) {
  worker ??= new Worker(URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' })));
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.error ? reject(new Error(data.error)) : resolve(new Blob([data.wav], { type: 'audio/wav' })));
    worker.onerror = (e) => { worker = null; reject(new Error(e.message || 'the decoder couldn’t load')); };
    worker.postMessage(bytes, [bytes]);
  });
}
