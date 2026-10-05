// AutoMix (Settings → Playback), like Apple Music's: songs blend into each
// other in time with the beat.
//
// Each song is decoded once and measured: its tempo and where the beats fall
// (from an onset envelope, autocorrelation and a phase search), and where the
// music really starts and ends (skipping silence and long fade-outs). The mix
// then starts on a beat of the outgoing song, the incoming song is sped up or
// slowed down slightly (±8%) so the beats line up, and the bass swaps halfway
// through. Mixes start on the first beat of a bar (the beat of each four where
// the kick hits hardest), just before the outro fades, and not before the last
// sung line has finished; the incoming song comes in on its own first bar.

const SR = 22050;      // analysis sample rate
const HOP = 256;       // ≈ 11.6 ms per frame
const MIN_BPM = 70, MAX_BPM = 180;

/** Mono samples → { bpm, period, offset, start, end, duration } (seconds). */
export function analyzeSamples(x, sr = SR) {
  const frames = Math.floor(x.length / HOP);
  const dt = HOP / sr;
  const energy = new Float32Array(frames);
  const low = new Float32Array(frames);
  let lp = 0;
  const a = Math.exp(-2 * Math.PI * 150 / sr); // one-pole low-pass for the kick
  for (let f = 0; f < frames; f++) {
    let e = 0, el = 0;
    for (let i = f * HOP, end = i + HOP; i < end; i++) {
      const v = x[i];
      lp = v + a * (lp - v);
      e += v * v; el += lp * lp;
    }
    energy[f] = e / HOP; low[f] = el / HOP;
  }
  // Where the music is: louder than (median − 24 dB), from the first such frame to the last.
  const dbs = Array.from(energy, (e) => 10 * Math.log10(e + 1e-12));
  const sorted = dbs.filter((d) => d > -90).sort((p, q) => p - q);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : -90;
  const gate = Math.max(-60, median - 24);
  let s = 0, e = frames - 1;
  while (s < frames && dbs[s] < gate) s++;
  while (e > s && dbs[e] < gate) e--;
  // Onsets: rises in (log) energy, with the low band counted twice. The low
  // band alone is kept for finding bars (the kick lands hardest on beat one).
  const onset = new Float32Array(frames), lowOnset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d1 = Math.log(energy[f] + 1e-9) - Math.log(energy[f - 1] + 1e-9);
    const d2 = Math.log(low[f] + 1e-9) - Math.log(low[f - 1] + 1e-9);
    lowOnset[f] = Math.max(0, d2) * Math.sqrt(low[f]);
    onset[f] = Math.max(0, d1) + 2 * Math.max(0, d2);
  }
  // The outro: from where the music stays 6 dB under its usual level (1 s
  // average) to the end, so a long fade-out is mixed over, not played out.
  const win = Math.max(1, Math.round(1 / dt));
  const smooth = new Float32Array(frames);
  let run = 0;
  for (let f = 0; f < frames; f++) {
    run += energy[f] - (f >= win ? energy[f - win] : 0);
    smooth[f] = 10 * Math.log10(Math.max(0, run) / Math.min(f + 1, win) + 1e-12);
  }
  const levels = Array.from(smooth.subarray(s, e + 1)).sort((p, q) => p - q);
  const usual = levels.length ? levels[Math.floor(levels.length * 0.6)] : -90;
  let outro = e;
  while (outro > s && smooth[outro] < usual - 6) outro--;
  const outroAt = (outro + 1) * dt;
  // Tempo from the middle of the song (up to 90 s).
  const mid = Math.floor((s + e) / 2);
  const half = Math.min(Math.floor(45 / dt), Math.floor((e - s) / 2));
  const w0 = Math.max(1, mid - half), w1 = Math.min(frames, mid + half);
  let mean = 0;
  for (let f = w0; f < w1; f++) mean += onset[f];
  mean /= Math.max(1, w1 - w0);
  const lagMin = Math.floor(60 / MAX_BPM / dt), lagMax = Math.ceil(60 / MIN_BPM / dt);
  const ac = new Float32Array(lagMax + 2);
  for (let lag = lagMin; lag <= lagMax + 1; lag++) {
    let sum = 0;
    for (let f = w0; f + lag < w1; f++) sum += (onset[f] - mean) * (onset[f + lag] - mean);
    ac[lag] = sum;
  }
  let best = -1, bestScore = -Infinity;
  for (let lag = lagMin + 1; lag <= lagMax; lag++) {
    const bpm = 60 / (lag * dt);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2); // people's tempos centre near 120
    const score = ac[lag] * prior;
    if (ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1] && score > bestScore) { bestScore = score; best = lag; }
  }
  if (best < 0 || !(ac[best] > 0)) return { bpm: 0, period: 0, offset: 0, start: s * dt, end: (e + 1) * dt, outro: outroAt, duration: x.length / sr };
  // Sub-frame peak, then fold into 78–160 BPM.
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const shift = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  let period = (best + Math.max(-0.5, Math.min(0.5, shift))) * dt;
  while (60 / period < 78) period /= 2;
  while (60 / period >= 160) period *= 2;
  // Fine-tune the tempo and find the beat phase together (over the middle of the song).
  let fit = null;
  for (let k = -12; k <= 12; k++) {
    const p = period * (1 + k * 0.0004);
    const g = bestPhase(onset, p / dt, w0, w1);
    if (!fit || g.score > fit.score) fit = { period: p, ...g };
  }
  return { bpm: 60 / fit.period, period: fit.period, offset: fit.offset * dt, start: s * dt, end: (e + 1) * dt, outro: outroAt, duration: x.length / sr, onset, lowOnset, dt };
}

/** The phase (in frames, 0..pf) whose beat grid collects the most onset strength in [w0, w1). */
function bestPhase(onset, pf, w0, w1) {
  let offset = 0, score = -Infinity;
  for (let o = 0; o < pf; o += 0.25) {
    let sum = 0;
    for (let k = Math.ceil((w0 - o) / pf); o + k * pf < w1; k++) {
      const i = Math.round(o + k * pf);
      sum += (onset[i] || 0) + 0.5 * ((onset[i - 1] || 0) + (onset[i + 1] || 0));
    }
    if (sum > score) { score = sum; offset = o; }
  }
  return { offset, score };
}

/**
 * The beat grid near [t0, t1] (seconds): same tempo, phase measured right
 * there, so small tempo drift over a song doesn't throw the mix off.
 * downbeat: a beat that starts a bar, or null when it can't be told.
 */
export function gridNear(a, t0, t1) {
  if (!a.period || !a.onset) return { period: a.period, offset: a.offset, downbeat: null };
  const w0 = Math.max(1, Math.floor(t0 / a.dt)), w1 = Math.min(a.onset.length, Math.ceil(t1 / a.dt));
  if (w1 - w0 < (2 * a.period) / a.dt) return { period: a.period, offset: a.offset, downbeat: null };
  const { offset } = bestPhase(a.onset, a.period / a.dt, w0, w1);
  const grid = { period: a.period, offset: offset * a.dt };
  return { ...grid, downbeat: findDownbeat(a, grid, w0, w1) };
}

/** Of the four beats in a bar, the one where the kick is strongest (as a time); null without a clear winner. */
function findDownbeat(a, grid, w0, w1) {
  if (!a.lowOnset) return null;
  const sums = [0, 0, 0, 0];
  const pf = grid.period / a.dt, o = grid.offset / a.dt;
  for (let k = Math.ceil((w0 - o) / pf); o + k * pf < w1; k++) {
    const i = Math.round(o + k * pf);
    let v = 0;
    for (let j = -2; j <= 2; j++) v = Math.max(v, a.lowOnset[i + j] || 0);
    sums[((k % 4) + 4) % 4] += v;
  }
  const order = [0, 1, 2, 3].sort((p, q) => sums[q] - sums[p]);
  if (!(sums[order[0]] > sums[order[1]] * 1.15)) return null;
  return grid.offset + order[0] * grid.period;
}

/** Decodes a song (blob: or media: URL) and analyses it. */
export async function analyzeUrl(url) {
  const data = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 2, SR);
  const buf = await ctx.decodeAudioData(data);
  let x = buf.getChannelData(0);
  if (buf.numberOfChannels > 1) {
    const r = buf.getChannelData(1);
    const m = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) m[i] = (x[i] + r[i]) / 2;
    x = m;
  }
  return analyzeSamples(x, buf.sampleRate);
}

/** Tempo ratio for the incoming song (its playbackRate), or 1 when the tempos are too far apart. */
export function tempoRatio(outBpm, inBpm, max = 0.08) {
  if (!outBpm || !inBpm) return 1;
  let best = 1, off = Infinity;
  for (const k of [0.5, 1, 2]) {
    const r = outBpm / (inBpm * k);
    if (Math.abs(r - 1) < off) { off = Math.abs(r - 1); best = r; }
  }
  return off <= max ? best : 1;
}

/** Next beat of `a` at or after time t. */
export const beatAtOrAfter = (a, t) => (a.period ? a.offset + Math.ceil((t - a.offset) / a.period - 1e-6) * a.period : t);

/** A grid's bar (its downbeat and four beats), or its beat when bars weren't found. */
const barOf = (g) => (g.downbeat != null ? { offset: g.downbeat, period: 4 * g.period } : { offset: g.offset, period: g.period });

/**
 * When the mix starts and how long it lasts, for the outgoing song `a` and
 * incoming song `b`: { at, secs, rate, inAt, beats }.
 * vocalEnd: seconds into `a` where its last sung line ends (from the lyrics).
 */
export function planMix(a, b, { beats = 16, minSecs = 5, maxSecs = 14, vocalEnd = null } = {}) {
  const rate = a.bpm && b.bpm ? tempoRatio(a.bpm, b.bpm) : 1;
  const synced = rate !== 1 || (a.bpm && b.bpm && Math.abs(a.bpm - b.bpm) / a.bpm < 0.01);
  const beatLen = a.period || 0.5;
  let secs = Math.min(maxSecs, Math.max(minSecs, beats * beatLen));
  secs = Math.min(secs, Math.max(2, (a.end - a.start) / 4));
  const outro = Math.min(a.outro ?? a.end, a.end);
  // Beat grids measured where they're used: the outgoing song's ending, the incoming song's start.
  const outGrid = gridNear(a, outro - secs - 16, a.end);
  const inGrid = gridNear(b, b.start, b.start + 15);
  // The latest start that lets the outgoing song play through the whole mix;
  // earlier when it fades out slowly, so the blend covers the fade.
  const latest = a.end - secs;
  let at = Math.min(latest, outro - secs * 0.25);
  // Never over the last sung line: wait for it, with a shorter mix if needed.
  const sung = vocalEnd != null && vocalEnd < a.end ? vocalEnd + 0.3 : null;
  if (sung != null && at < sung) {
    at = Math.min(sung, latest);
    if (sung > latest && a.end - sung >= 3) { at = sung; secs = a.end - sung; }
  }
  // Start on a bar (or a beat): the one at or before `at`, or the next one if that is still sung over.
  const outBar = barOf(outGrid);
  if (outBar.period) {
    let snapped = outBar.offset + Math.floor((at - outBar.offset) / outBar.period + 1e-6) * outBar.period;
    if (sung != null && snapped < sung) snapped += outBar.period;
    if (snapped + 2 <= a.end) { at = snapped; secs = Math.min(secs, a.end - at); }
  }
  // The incoming song comes in on its first bar (or beat) after the silence at its start.
  const inBar = barOf(inGrid);
  const inAt = inBar.period ? Math.max(0, beatAtOrAfter(inBar, b.start)) : b.start;
  return { at: Math.max(0, at), secs, rate: synced ? rate : 1, inAt, beats: Math.round(secs / beatLen), synced: !!synced, outGrid, inGrid };
}

/**
 * Where to put the incoming song so its beats fall on the outgoing song's:
 * outPos is the outgoing song's position now; returns the incoming position.
 */
export function alignedPosition(a, b, outPos, inAt) {
  if (!a.period || !b.period) return inAt;
  // The same place in the bar when both songs' bars are known, else in the beat.
  const bars = a.downbeat != null && b.downbeat != null;
  const out = bars ? barOf(a) : a, inc = bars ? barOf(b) : b;
  let phase = ((outPos - out.offset) / out.period) % 1; // 0..1 into the outgoing bar / beat
  if (phase < 0) phase += 1;
  const k = Math.round((inAt - inc.offset) / inc.period);
  return Math.max(0, inc.offset + (k + phase) * inc.period);
}
