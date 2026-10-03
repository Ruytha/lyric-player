// Self-contained demo: a synthesized backing track, generated artwork and a
// word-timed TTML with placeholder lyrics that exercises every feature
// (syllables, duets, background vocals, held/emphasis words, interludes,
// translations, line wrapping).

// "|" splits syllables, "*" marks a held word.
const SCRIPT = [
  { at: 6.0, agent: 'v1', text: 'Line one of the test song' },
  { agent: 'v1', text: 'Syl|la|bles stay to|ge|ther in one word' },
  { agent: 'v2', text: 'This is the se|cond sing|er on the right' },
  { agent: 'v1', text: 'Main vo|cal line with a back|ing part', bg: 'ech|o ech|o' },
  { agent: 'v1', text: 'Hold on to this mo|ment*' },
  { at: 32.0, agent: 'v1', text: 'Back a|gain af|ter the in|ter|lude' },
  { agent: 'v2', text: 'A du|et an|swer from the right side', bg: 'right side' },
  { agent: 'v1000', text: 'Ev|ery|bo|dy sings to|ge|ther now*' },
  { agent: 'v1', text: 'A ve|ry long line that should wrap a|cross two rows when the pa|nel is nar|row e|nough' },
  { agent: 'v1', text: 'Shi|ning*' },
  { agent: 'v1', text: 'Fi|nal line of the test song' },
];

const SYL = 0.27;       // seconds per syllable
const HELD = 1.7;       // total length of a held word
const LINE_GAP = 0.55;
const DURATION = 72;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ts = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
};

function spans(text, start) {
  let t = start;
  const words = text.split(' ').map((word) => {
    const held = word.endsWith('*');
    const syls = word.replace('*', '').split('|');
    const each = held ? HELD / syls.length : SYL;
    return syls.map((s) => {
      const b = t;
      t += each;
      return `<span begin="${ts(b)}" end="${ts(t)}">${esc(s)}</span>`;
    }).join('');
  });
  return { xml: words.join(' '), end: t };
}

export function buildDemoTTML() {
  let t = 0;
  const ps = SCRIPT.map((line, i) => {
    if (line.at != null) t = line.at;
    const begin = t;
    const main = spans(line.text, begin);
    let end = main.end;
    let bgXml = '';
    if (line.bg) {
      const bg = spans(`(${line.bg})`, main.end - 0.4);
      bgXml = ` <span ttm:role="x-bg">${bg.xml}</span>`;
      end = Math.max(end, bg.end);
    }
    t = end + LINE_GAP;
    const plain = line.text.replace(/[|*]/g, '');
    return `<p begin="${ts(begin)}" end="${ts(end + 0.25)}" ttm:agent="${line.agent}" itunes:key="L${i + 1}">${main.xml}${bgXml}<span ttm:role="x-translation" xml:lang="fr">Translated line ${i + 1}: ${esc(plain.toLowerCase())}</span></p>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="en"><head><metadata><ttm:title>Test Song</ttm:title><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/><ttm:agent type="group" xml:id="v1000"/></metadata></head><body dur="${ts(DURATION)}"><div itunes:song-part="Verse">${ps.slice(0, 5).join('')}</div><div itunes:song-part="Chorus">${ps.slice(5).join('')}</div></body></tt>`;
}

/** Soft pad + kick at 96 BPM, mono 16-bit WAV. */
export function buildDemoAudio() {
  const rate = 22050;
  const n = Math.floor(DURATION * rate);
  const data = new Float32Array(n);
  const chords = [[261.63, 329.63, 392.0], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]];
  const bar = 2.5;
  const beat = 60 / 96;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const ci = Math.floor(t / bar) % chords.length;
    const local = t % bar;
    const env = Math.min(1, local / 0.3) * (0.6 + 0.4 * Math.exp(-local * 1.2));
    let s = 0;
    for (const f of chords[ci]) s += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.003 * t);
    s *= 0.05 * env;
    s += 0.06 * Math.sin(2 * Math.PI * (chords[ci][0] / 2) * t) * env;
    const kt = t % beat;
    if (kt < 0.18) s += 0.35 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-kt * 30)) * kt) * Math.exp(-kt * 18);
    const fade = Math.min(1, t / 1.5, (DURATION - t) / 3);
    data[i] = s * fade;
  }
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
  return new File([buf], 'Demo Artist - Test Song.wav', { type: 'audio/wav' });
}

/** Blue abstract cover so the background shows its typical slate-blue tone. */
export function buildDemoArtwork() {
  const c = document.createElement('canvas');
  c.width = c.height = 600;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 600, 600);
  grad.addColorStop(0, '#1d3f7a');
  grad.addColorStop(1, '#0b1a35');
  g.fillStyle = grad;
  g.fillRect(0, 0, 600, 600);
  const blobs = [[170, 190, 210, '#3f7fd6'], [430, 380, 240, '#2a5aa8'], [300, 520, 160, '#7fb2ff'], [480, 120, 120, '#9cc4ff']];
  for (const [x, y, r, col] of blobs) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 600, 600);
  }
  g.strokeStyle = 'rgba(255,255,255,.55)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(300, 300, 120, 0, Math.PI * 2);
  g.stroke();
  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}
