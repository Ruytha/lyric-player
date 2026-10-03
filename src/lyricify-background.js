// "Apple Music inspired (iOS)" background, ported to WebGL 2 from Lyricify
// Backgrounds by WXRIW (github.com/WXRIW/Lyricify-Backgrounds, Apache License
// 2.0): Lyricify.Backgrounds.AppleMusicInspired.Ios(.Shared/.WinUI). The
// passes, constants, blur kernel and mesh presets are the original's; only
// the graphics API changed (Direct3D 11 / HLSL → WebGL 2 / GLSL).
//
// Each frame:
//  1. Rotation: an aspect-filled copy of the cover, then three rotating,
//     overlapping copies of it, into a small (downsampled) surface.
//  2. A wide Gaussian blur (sigma 42.5, 77 paired taps), horizontal then
//     vertical, with zero borders normalized by coverage.
//  3. Composite: the blurred image, "treated" (saturation up then down,
//     clamped, 40% black scrim), drawn full screen and then again through a
//     slowly morphing pinch mesh behind the lyrics. Dithered to avoid banding.
// The bass gently scales the rotating layers, like the original's spectrum
// pulse. Same interface as AmllBackground: setImage / setActive / apply / update.

import { PORTRAIT, LANDSCAPE } from './lyricify-mesh-data.js';

const ARTWORK_TRANSITION = 0.5;     // s
const LYRICS_MODE_TRANSITION = 0.25; // s
const BLUR_DOWNSAMPLE = 4;
const KERNEL_SIGMA = 42.5;
const LYRICS_SIGMA = 42.5;
const ORDINARY_SIGMA = 80;
const SCRIM = 0.4;                   // dark appearance
const PORTRAIT_TEXTURE_SCALE = 1;
const LANDSCAPE_TEXTURE_SCALE = 0.8;
const MAX_ARTWORK = 300;
const PULSE_INTENSITY = 0.33;

// Normalized sigma-42.5 kernel with paired bilinear taps (from the original shader).
const BLUR_CENTER = 0.009389731878;
const BLUR_OFFSETS = [1.499792388, 3.499515571, 5.499238755, 7.498961939, 9.498685124, 11.49840831, 13.498131497, 15.497854684, 17.497577874, 19.497301064, 21.497024257, 23.496747451, 25.496470647, 27.496193845, 29.495917046, 31.495640249, 33.495363455, 35.495086663, 37.494809875, 39.49453309, 41.494256308, 43.49397953, 45.493702755, 47.493425984, 49.493149218, 51.492872455, 53.492595697, 55.492318943, 57.492042195, 59.49176545, 61.491488712, 63.491211978, 65.490935249, 67.490658527, 69.490381809, 71.490105098, 73.489828393, 75.489551694, 77.489275002, 79.488998316, 81.488721637, 83.488444964, 85.488168299, 87.487891641, 89.487614991, 91.487338348, 93.487061713, 95.486785085, 97.486508466, 99.486231855, 101.485955253, 103.485678659, 105.485402074, 107.485125498, 109.484848931, 111.484572373, 113.484295824, 115.484019286, 117.483742757, 119.483466238, 121.483189729, 123.482913231, 125.482636742, 127.482360265, 129.482083798, 131.481807343, 133.481530898, 135.481254465, 137.480978043, 139.480701633, 141.480425235, 143.480148848, 145.479872474, 147.479596112, 149.479319763, 151.479043426, 153.0];
const BLUR_WEIGHTS = [0.0187664737, 0.01871460399, 0.01862159953, 0.01848807512, 0.01831490985, 0.01810323743, 0.01785443382, 0.01757010239, 0.01725205665, 0.01690230103, 0.01652300989, 0.01611650499, 0.01568523193, 0.01523173574, 0.01475863601, 0.01426860189, 0.01376432738, 0.01324850701, 0.01272381248, 0.01219287029, 0.0116582408, 0.01112239879, 0.01058771585, 0.01005644461, 0.00953070502, 0.00901247274, 0.00850356966, 0.0080056566, 0.00752022811, 0.0070486094, 0.00659195523, 0.00615125069, 0.0057273138, 0.00532079962, 0.00493220595, 0.0045618802, 0.0042100274, 0.00387671917, 0.00356190339, 0.00326541439, 0.00298698364, 0.0027262505, 0.00248277319, 0.00225603955, 0.00204547767, 0.00185046618, 0.00167034405, 0.00150441998, 0.0013519811, 0.00121230117, 0.00108464796, 0.00096829001, 0.00086250273, 0.00076657363, 0.00067980702, 0.00060152792, 0.00053108534, 0.00046785492, 0.00041124106, 0.00036067838, 0.0003156328, 0.00027560209, 0.00024011609, 0.0002087365, 0.00018105641, 0.00015669956, 0.00013531939, 0.00011659788, 0.0001002443, 0.00008599378, 0.00007360593, 0.00006286326, 0.00005356972, 0.00004554915, 0.00003864377, 0.00003271276, 0.00001440207];

const f = (n) => (Number.isInteger(n) ? `${n}.0` : String(n));

// ---------------------------------------------------------------------------
// Shaders. Artwork textures keep image orientation (v = 0 at the top, as in
// Direct3D); render targets are sampled in GL orientation (v = 0 at the bottom).

const QUAD_VS = `#version 300 es
in vec2 aPos; in vec2 aUv;
out vec2 vUv;
uniform int uMode;            // 0 fullscreen, 1 artwork fill, 2 rotating layer
uniform vec2 uViewScale;
uniform float uTime, uRotationScale, uImageScale;
vec2 rot(vec2 v, float a) { float s = sin(a), c = cos(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
void main() {
  vUv = aUv;
  vec2 p = aPos;
  if (uMode == 1) { vUv = (aUv - 0.5) / uViewScale + 0.5; }
  else if (uMode == 2) {
    int id = gl_InstanceID;
    const float twoPi = 6.2831853071795864769;
    float period = id == 1 ? 70.0 : id == 2 ? 90.0 : 120.0;
    float scale = id == 0 ? 1.4 : 0.7;
    vec2 move = id == 1 ? vec2(-0.25, 0.15) : id == 2 ? vec2(0.7, 0.7) : vec2(0.0);
    p = rot(p, uTime * uRotationScale * twoPi / period);
    p *= scale;
    p += move;
    p *= uViewScale;
    if (id == 2) p = rot(p, uTime * uRotationScale * twoPi / 120.0);
    p *= uImageScale;
  }
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const ROTATION_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uCur, uPrev; uniform float uMix;
void main() {
  vec3 c = texture(uCur, vUv).rgb, p = texture(uPrev, vUv).rgb;
  o = vec4(mix(p, c, uMix), 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uSrc; uniform vec2 uDir; uniform vec2 uSize; uniform bool uNormalize;
const float W[${BLUR_WEIGHTS.length}] = float[](${BLUR_WEIGHTS.map(f).join(',')});
const float OFF[${BLUR_OFFSETS.length}] = float[](${BLUR_OFFSETS.map(f).join(',')});
// Zero outside the surface (Direct3D's zero-border sampler).
vec4 tap(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(uSrc, uv); }
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec4 c = tap(uv) * ${f(BLUR_CENTER)};
  for (int i = 0; i < ${BLUR_OFFSETS.length}; i++) {
    vec2 d = uDir * OFF[i];
    c += (tap(uv + d) + tap(uv - d)) * W[i];
  }
  if (uNormalize) { c.rgb /= max(c.a, 1.0 / 65535.0); c.a = 1.0; }
  o = c;
}`;

const MESH_VS = `#version 300 es
in vec2 aFrom; in vec2 aTo; in vec2 aUv;
out vec2 vLyricUv; out vec2 vScreenUv;
uniform float uTime; uniform vec4 uPinch; uniform bool uFullscreen;
void main() {
  vec2 p;
  vec2 tc;
  if (uFullscreen) { p = aFrom; tc = aUv; }
  else {
    const float pi = 3.14159265358979323846;
    float phase = acos(sin(uTime * pi / 5.0)) / pi;
    float m = phase * phase * (3.0 - 2.0 * phase);
    p = mix(aFrom, aTo, m);
    tc = aUv * uPinch.xy + uPinch.zw;
  }
  vLyricUv = vec2(tc.x, 1.0 - tc.y);        // Direct3D → GL orientation
  vScreenUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const MATERIAL_FS = `#version 300 es
precision highp float;
in vec2 vLyricUv; in vec2 vScreenUv; out vec4 o;
uniform sampler2D uLyrics, uOrdinary; uniform float uLyricsMix, uScrim, uDither;
vec3 sat(vec3 c, float s) {
  vec3 r = vec3(0.2126 + 0.7873 * s, 0.2126 - 0.2126 * s, 0.2126 - 0.2126 * s);
  vec3 g = vec3(0.7152 - 0.7152 * s, 0.7152 + 0.2848 * s, 0.7152 - 0.7152 * s);
  vec3 b = vec3(0.0722 - 0.0722 * s, 0.0722 - 0.0722 * s, 0.0722 + 0.9278 * s);
  return r * c.r + g * c.g + b * c.b;
}
vec3 treat(vec3 c) {
  c = sat(c, 1.4);
  c = clamp(c, -0.752941, 1.25098);
  c = sat(c, 0.70);
  return mix(c, vec3(0.0), uScrim);
}
vec3 material(sampler2D s, vec2 uv) { vec4 t = texture(s, uv); return treat(t.rgb / max(t.a, 1.0 / 65535.0)); }
void main() {
  vec3 lyric = material(uLyrics, vLyricUv);
  vec3 color = uLyricsMix >= 1.0 ? lyric : mix(material(uOrdinary, vScreenUv), lyric, uLyricsMix);
  float d = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
  color += d * (uDither / 255.0);
  o = vec4(clamp(color, 0.07, 0.97), 1.0);
}`;

// ---------------------------------------------------------------------------
// Mesh (AppleMusicIosMesh.Create: Catmull–Clark subdivided control grid)

function grid(flat, n) {
  const g = [];
  for (let r = 0; r < n; r++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push([flat[(r * n + c) * 2], flat[(r * n + c) * 2 + 1]]);
    g.push(row);
  }
  return g;
}

function identity(n) {
  const out = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) out.push(c / (n - 1), r / (n - 1));
  return out;
}

const add = (...v) => v.reduce((a, b) => [a[0] + b[0], a[1] + b[1]]);
const mul = (a, k) => [a[0] * k, a[1] * k];

function subdivide(src) {
  const rows = src.length, cols = src[0].length;
  const face = [];
  for (let r = 0; r < rows - 1; r++) {
    face.push([]);
    for (let c = 0; c < cols - 1; c++) face[r].push(mul(add(src[r][c], src[r][c + 1], src[r + 1][c], src[r + 1][c + 1]), 0.25));
  }
  const out = Array.from({ length: rows * 2 - 1 }, () => new Array(cols * 2 - 1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const br = r === 0 || r === rows - 1, bc = c === 0 || c === cols - 1;
      const p = src[r][c];
      if (br && bc) out[r * 2][c * 2] = p;
      else if (br) out[r * 2][c * 2] = mul(add(src[r][c - 1], mul(p, 6), src[r][c + 1]), 1 / 8);
      else if (bc) out[r * 2][c * 2] = mul(add(src[r - 1][c], mul(p, 6), src[r + 1][c]), 1 / 8);
      else {
        const fa = mul(add(face[r - 1][c - 1], face[r - 1][c], face[r][c - 1], face[r][c]), 0.25);
        const ea = mul(add(mul(add(p, src[r - 1][c]), 0.5), mul(add(p, src[r + 1][c]), 0.5), mul(add(p, src[r][c - 1]), 0.5), mul(add(p, src[r][c + 1]), 0.5)), 0.25);
        out[r * 2][c * 2] = mul(add(fa, mul(ea, 2), p), 0.25);
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = src[r][c], b = src[r][c + 1];
      out[r * 2][c * 2 + 1] = r === 0 || r === rows - 1 ? mul(add(a, b), 0.5) : mul(add(a, b, face[r - 1][c], face[r][c]), 0.25);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      const a = src[r][c], b = src[r + 1][c];
      out[r * 2 + 1][c * 2] = c === 0 || c === cols - 1 ? mul(add(a, b), 0.5) : mul(add(a, b, face[r][c - 1], face[r][c]), 0.25);
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) out[r * 2 + 1][c * 2 + 1] = face[r][c];
  return out;
}

/** { data: Float32Array [fromX, fromY, toX, toY, u, v]*, indices: Uint16Array } */
export function createMesh(vertical, preset, levels = 2) {
  let from, to, n;
  if (vertical) { n = 6; [from, to] = PORTRAIT[preset % PORTRAIT.length]; }
  else { n = 9; from = identity(9); to = LANDSCAPE[preset % LANDSCAPE.length]; }
  let gf = grid(from, n), gt = grid(to, n);
  for (let i = 0; i < levels; i++) { gf = subdivide(gf); gt = subdivide(gt); }
  const rows = gf.length, cols = gf[0].length;
  const data = new Float32Array(rows * cols * 6);
  for (let r = 0; r < rows; r++) {
    const v = 1 - r / (rows - 1);
    for (let c = 0; c < cols; c++) {
      const k = (r * cols + c) * 6;
      data[k] = gf[r][c][0] * 2 - 1;
      data[k + 1] = gf[r][c][1] * 2 - 1;
      data[k + 2] = gt[r][c][0] * 2 - 1;
      data[k + 3] = gt[r][c][1] * 2 - 1;
      data[k + 4] = c / (cols - 1);
      data[k + 5] = v;
    }
  }
  const indices = new Uint16Array((rows - 1) * (cols - 1) * 6);
  let i = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const bl = r * cols + c, br = bl + 1, tl = bl + cols, tr = tl + 1;
      indices.set([bl, tl, tr, tr, br, bl], i);
      i += 6;
    }
  }
  return { data, indices };
}

// The original picks one of five slots; slots 2 and 3 share a portrait mesh.
const pickPortrait = () => [0, 1, 2, 2, 3][Math.floor(Math.random() * 5)];
const pickLandscape = () => Math.floor(Math.random() * 5);

function easeInOut(p) {
  if (p <= 0 || p >= 1) return p;
  let lo = 0, hi = 1, t = p;
  for (let i = 0; i < 12; i++) {
    t = (lo + hi) / 2;
    const u = 1 - t;
    const x = 3 * u * u * t * 0.42 + 3 * u * t * t * 0.58 + t * t * t;
    if (x < p) lo = t; else hi = t;
  }
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------

export class LyricifyBackground {
  /** Throws if WebGL 2 isn't available. */
  constructor(container) {
    const canvas = document.createElement('canvas');
    canvas.className = 'lyricify-bg';
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 unavailable');
    this.gl = gl;
    this.canvas = canvas;
    this.container = container;
    container.prepend(canvas);
    this.float = !!gl.getExtension('EXT_color_buffer_float');

    this.quadProg = { rotation: this.program(QUAD_VS, ROTATION_FS), blur: this.program(QUAD_VS, BLUR_FS) };
    this.meshProg = this.program(MESH_VS, MATERIAL_FS);

    // Fullscreen quad: position, artwork uv (v = 0 at the top).
    this.quad = this.buffer(new Float32Array([-1, -1, 0, 1, -1, 1, 0, 0, 1, 1, 1, 0, -1, -1, 0, 1, 1, 1, 1, 0, 1, -1, 1, 1]));
    // The fullscreen material reuses the mesh program: from = to = corners.
    this.fullscreen = this.buffer(new Float32Array([-1, -1, -1, -1, 0, 1, -1, 1, -1, 1, 0, 0, 1, 1, 1, 1, 1, 0, -1, -1, -1, -1, 0, 1, 1, 1, 1, 1, 1, 0, 1, -1, 1, -1, 1, 1]));
    this.meshBuf = gl.createBuffer();
    this.meshIdx = gl.createBuffer();
    this.portraitPreset = pickPortrait();
    this.landscapePreset = pickLandscape();
    this.vertical = null;

    this.cur = this.texture(this.placeholder());
    this.prev = null;
    this.transitionStart = -1;
    this.targets = null;
    this.time = 0;
    this.clock = 0;
    this.lyricsMix = 1;
    this.lyricsFrom = 1;
    this.lyricsTo = 1;
    this.lyricsStart = -1;
    this.active = true;
    this.pulse = 0;
    this.settings = { scale: 0.5, fps: 60, flow: 1, react: 0.6, pulse: 0.5, still: false };
    this.sinceFrame = Infinity;
    this.src = undefined;
    this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; });
  }

  // ------------------------------------------------------------------ GL

  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = new Proxy({}, { get: (c, name) => (name in c ? c[name] : (c[name] = gl.getUniformLocation(p, name))) });
    return { p, u, a: (name) => gl.getAttribLocation(p, name) };
  }

  buffer(data) {
    const gl = this.gl;
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  texture(source) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    return t;
  }

  surface(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Half floats keep the extended range until the final pass, as the original does.
    if (this.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  placeholder() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, '#56677f');
    grad.addColorStop(0.5, '#3a4659');
    grad.addColorStop(1, '#262d3a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  ensureSize() {
    const gl = this.gl;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(1, this.container.clientWidth), cssH = Math.max(1, this.container.clientHeight);
    const w = Math.max(1, Math.round(cssW * dpr * this.settings.scale));
    const h = Math.max(1, Math.round(cssH * dpr * this.settings.scale));
    this.renderScale = w / cssW;
    const vertical = h > w;
    if (vertical !== this.vertical) {
      this.vertical = vertical;
      const { data, indices } = createMesh(vertical, vertical ? this.portraitPreset : this.landscapePreset);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIdx);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.meshCount = indices.length;
    }
    if (this.canvas.width === w && this.canvas.height === h && this.targets) return;
    this.canvas.width = w;
    this.canvas.height = h;
    // Downsample for the widest blur while keeping adjacent taps.
    const down = BLUR_DOWNSAMPLE * Math.max(1, Math.max(LYRICS_SIGMA, ORDINARY_SIGMA) / KERNEL_SIGMA);
    const bw = Math.max(1, Math.floor(w / down)), bh = Math.max(1, Math.floor(h / down));
    if (this.targets) for (const t of Object.values(this.targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    this.targets = { rotation: this.surface(bw, bh), horizontal: this.surface(bw, bh), vertical: this.surface(bw, bh), ordinary: this.surface(bw, bh) };
  }

  // ------------------------------------------------------------ interface

  setActive(on) {
    this.active = on;
    this.canvas.hidden = !on;
  }

  async setImage(src) {
    this.src = src;
    let source = this.placeholder();
    if (src) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src;
        await img.decode();
        if (this.src !== src) return;
        // At most 300 px on the long side, like the original.
        const k = Math.min(1, MAX_ARTWORK / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        source = c;
      } catch { if (this.src !== src) return; }
    }
    if (this.lost) return;
    if (this.prev) this.gl.deleteTexture(this.prev);
    this.prev = this.cur;
    this.cur = this.texture(source);
    this.transitionStart = this.clock;
    this.sinceFrame = Infinity; // draw now, even when still
  }

  /** Behind lyrics (the warped mesh) or not (plain, blurrier). */
  setLyricsMode(on) {
    const to = on ? 1 : 0;
    if (to === this.lyricsTo) return;
    this.lyricsFrom = this.lyricsMix;
    this.lyricsTo = to;
    this.lyricsStart = this.clock;
    this.sinceFrame = Infinity;
  }

  apply(s) {
    this.settings = { scale: s.bgScale, fps: s.bgFps, flow: s.bgFlow, react: s.bgReact, pulse: s.bgPulse, still: s.bgStatic };
    this.sinceFrame = Infinity;
  }

  update(dt, playing, reactor = null) {
    if (!this.active || this.lost) return;
    this.clock += dt;
    // The original keeps turning at a constant rate; "Flow speed" scales it.
    if (!this.settings.still) this.time += dt * this.settings.flow;
    // Bass pulse: the same shaping as the original's spectrum pulse.
    const target = playing ? Math.min(1, (reactor?.bass || 0) * this.settings.react * 1.4) : 0;
    this.pulse += (target - this.pulse) * (1 - Math.exp(-dt / (target > this.pulse ? 0.04 : 0.18)));
    const transitioning = this.transitionStart >= 0 || this.lyricsStart >= 0;
    this.sinceFrame += dt;
    const interval = 1 / Math.max(1, this.settings.fps);
    if (this.settings.still && !transitioning && this.sinceFrame !== Infinity && this.pulse < 0.002) return;
    if (this.sinceFrame < interval * 0.95) return;
    this.sinceFrame = 0;
    this.render();
  }

  /** A still copy of the background as it looks now (for lyric cards), or null. */
  snapshot() {
    if (this.lost || !this.cur) return null;
    // Drawn and copied in the same task, so the WebGL buffer is still there.
    this.render();
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d').drawImage(this.canvas, 0, 0);
    return c;
  }

  // --------------------------------------------------------------- render

  render() {
    const gl = this.gl;
    this.ensureSize();
    const W = this.canvas.width, H = this.canvas.height;
    const t = this.targets;

    let mixArt = 1;
    if (this.transitionStart >= 0) {
      mixArt = Math.min(1, (this.clock - this.transitionStart) / ARTWORK_TRANSITION);
      if (mixArt >= 1) { this.transitionStart = -1; if (this.prev) { gl.deleteTexture(this.prev); this.prev = null; } }
    }
    if (this.lyricsStart >= 0) {
      const p = (this.clock - this.lyricsStart) / LYRICS_MODE_TRANSITION;
      if (p >= 1) { this.lyricsStart = -1; this.lyricsMix = this.lyricsTo; }
      else this.lyricsMix = this.lyricsFrom + (this.lyricsTo - this.lyricsFrom) * easeInOut(Math.max(0, p));
    }
    const lyricsMix = this.lyricsMix;
    const aspect = W / H;
    const viewScale = aspect >= 1 ? [1, aspect] : [1 / aspect, 1];
    const sigma = ORDINARY_SIGMA + (LYRICS_SIGMA - ORDINARY_SIGMA) * lyricsMix;
    const outSigma = sigma * BLUR_DOWNSAMPLE * this.renderScale;
    const blurScale = [outSigma * t.rotation.w / (W * KERNEL_SIGMA), outSigma * t.rotation.h / (H * KERNEL_SIGMA)];
    const x = Math.min(1, Math.max(0, this.pulse));
    const shaped = x * x * x * (x * (x * 6 - 15) + 10);
    const imageScale = 1 + PULSE_INTENSITY * shaped * shaped * this.settings.pulse * 2;

    const backdrop = (target, scale) => {
      // 1. Rotation
      const r = this.quadProg.rotation;
      gl.useProgram(r.p);
      this.bindQuad(r);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.rotation.fb);
      gl.viewport(0, 0, t.rotation.w, t.rotation.h);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(r.u.uViewScale, viewScale[0], viewScale[1]);
      gl.uniform1f(r.u.uTime, this.time);
      gl.uniform1f(r.u.uRotationScale, 1);
      gl.uniform1f(r.u.uImageScale, scale);
      gl.uniform1f(r.u.uMix, mixArt);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.cur);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.prev || this.cur);
      gl.uniform1i(r.u.uCur, 0);
      gl.uniform1i(r.u.uPrev, 1);
      gl.uniform1i(r.u.uMode, 1);              // aspect-fill copy underneath
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.uniform1i(r.u.uMode, 2);              // three rotating layers
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 3);
      // 2. Blur
      const b = this.quadProg.blur;
      gl.useProgram(b.p);
      this.bindQuad(b);
      gl.uniform1i(b.u.uMode, 0);
      gl.uniform1i(b.u.uSrc, 0);
      gl.activeTexture(gl.TEXTURE0);
      const pass = (src, dst, dir, normalize) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(b.u.uDir, dir[0], dir[1]);
        gl.uniform2f(b.u.uSize, dst.w, dst.h);
        gl.uniform1i(b.u.uNormalize, normalize ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      pass(t.rotation, t.horizontal, [blurScale[0] / t.rotation.w, 0], false);
      pass(t.horizontal, target, [0, blurScale[1] / t.rotation.h], true);
    };

    const needOrdinary = lyricsMix < 0.9999, needLyrics = lyricsMix > 0.0001;
    let lyricsTex, ordinaryTex;
    if (needOrdinary && needLyrics) {
      backdrop(t.ordinary, 1);
      backdrop(t.vertical, imageScale);
      ordinaryTex = t.ordinary.tex;
      lyricsTex = t.vertical.tex;
    } else {
      backdrop(t.vertical, needLyrics ? imageScale : 1);
      lyricsTex = ordinaryTex = t.vertical.tex;
    }

    // 3. Composite
    const m = this.meshProg;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(m.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lyricsTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, ordinaryTex);
    gl.uniform1i(m.u.uLyrics, 0);
    gl.uniform1i(m.u.uOrdinary, 1);
    gl.uniform1f(m.u.uScrim, SCRIM);
    gl.uniform1f(m.u.uDither, 1);
    gl.uniform1f(m.u.uTime, this.time);
    const ts = this.vertical ? PORTRAIT_TEXTURE_SCALE : LANDSCAPE_TEXTURE_SCALE;
    gl.uniform4f(m.u.uPinch, ts, ts, (1 - ts) / 2, (1 - ts) / 2);
    // Full screen (fills gaps the moving mesh exposes), then the pinch mesh.
    gl.uniform1f(m.u.uLyricsMix, needLyrics ? lyricsMix : 0);
    gl.uniform1i(m.u.uFullscreen, 1);
    this.bindMesh(m, this.fullscreen);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (needLyrics) {
      gl.uniform1i(m.u.uFullscreen, 0);
      this.bindMesh(m, this.meshBuf);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.meshIdx);
      gl.drawElements(gl.TRIANGLES, this.meshCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  /** Only the current program's attributes stay enabled. */
  resetAttribs() {
    for (let i = 0; i < 4; i++) this.gl.disableVertexAttribArray(i);
  }

  bindQuad(prog) {
    const gl = this.gl;
    this.resetAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const pos = prog.a('aPos'), uv = prog.a('aUv');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 16, 0);
    if (uv >= 0) { gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8); }
  }

  bindMesh(prog, buf) {
    const gl = this.gl;
    this.resetAttribs();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const a = [prog.a('aFrom'), prog.a('aTo'), prog.a('aUv')];
    a.forEach((loc, i) => { if (loc < 0) return; gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 24, i * 8); });
  }
}
