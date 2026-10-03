// Plays an Apple Music animated cover (an HLS stream) over the artwork image.
// Uses the browser's own HLS support when it has it, else hls.js (vendored).

const HLS_URL = new URL('./vendor/hls.light.min.js', import.meta.url).href;

let hlsPromise = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  hlsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HLS_URL;
    s.onload = () => (window.Hls ? resolve(window.Hls) : reject(new Error('hls.js missing')));
    s.onerror = () => { hlsPromise = null; reject(new Error('Failed to load hls.js')); };
    document.head.appendChild(s);
  });
  return hlsPromise;
}

export class MotionArtwork {
  /** host: the element the video covers (the .art box). */
  constructor(host) {
    this.host = host;
    this.video = document.createElement('video');
    this.video.className = 'motion-art';
    this.video.muted = true;
    this.video.loop = true;
    this.video.playsInline = true;
    this.video.setAttribute('aria-hidden', 'true');
    this.video.crossOrigin = 'anonymous';
    host.appendChild(this.video);
    this.hls = null;
    this.url = null;
    this.video.addEventListener('playing', () => this.host.classList.add('motion-on'));
    this.video.addEventListener('error', () => { if (this.url) this.clear(); });
    document.addEventListener('visibilitychange', () => {
      if (!this.url) return;
      if (document.hidden) this.video.pause();
      else this.video.play().catch(() => {});
    });
  }

  get active() { return !!this.url; }

  async play(url) {
    if (url === this.url) return;
    this.clear();
    if (!url) return;
    this.url = url;
    const v = this.video;
    // hls.js wherever Media Source works (Chromium's own HLS support is
    // patchy); Safari/iOS without it play the stream natively.
    const mse = !!(window.MediaSource || window.ManagedMediaSource);
    if (!mse && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = url;
    } else {
      const Hls = await loadHls();
      if (this.url !== url) return;
      if (!Hls.isSupported()) { this.clear(); throw new Error('this browser can\'t play animated covers'); }
      // Size-matched quality: the cover is at most a few hundred px on screen.
      this.hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20, startLevel: -1 });
      this.hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) this.clear(); });
      this.hls.loadSource(url);
      this.hls.attachMedia(v);
    }
    v.play().catch(() => { /* starts once media is ready (autoplay is muted) */ });
  }

  clear() {
    this.url = null;
    this.host.classList.remove('motion-on');
    this.hls?.destroy();
    this.hls = null;
    this.video.removeAttribute('src');
    this.video.load();
  }
}
