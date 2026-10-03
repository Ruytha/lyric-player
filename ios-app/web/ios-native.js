// iPhone app (Capacitor): gives the player the same `lyricPlayerNative`
// bridge the desktop app has, for the parts that make sense on iOS:
//  - lyrics and animated-cover lookups that a web page can't make itself
//    (NetEase, QQ Music, Apple Music album pages), sent from the app with
//    native networking instead of the desktop app's main process;
//  - "music playing on this phone": what the Music app is playing, from the
//    LyricNative plugin (ios-app/plugin).
// A plain script, so it runs before the player's modules read the bridge.

(function () {
  var C = window.Capacitor;
  if (!C || !C.getPlatform || C.getPlatform() !== 'ios') return;
  document.documentElement.classList.add('ios');

  var Native = C.registerPlugin('LyricNative');
  var Http = C.registerPlugin('CapacitorHttp');
  var listeners = [];
  var subscribed = null;

  function parse(data) {
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (e) { return data; }
  }

  function check(r, name) {
    if (r.status >= 400) throw new Error(name + ' HTTP ' + r.status);
    return r;
  }

  window.lyricPlayerNative = {
    platform: 'ios',

    netease: async function (kind, params) {
      var m = await import('./src/netease.js');
      var url = m.neteaseUpstreamUrl(kind, params || {});
      var r = check(await Http.get({
        url: url,
        headers: { Referer: 'https://music.163.com/', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' },
        responseType: 'json',
      }), 'NetEase');
      return parse(r.data);
    },

    qqMusic: async function (kind, params) {
      var m = await import('./src/qq-music.js');
      var req = m.qqUpstreamRequest(kind, params || {});
      var r = check(await Http.post({ url: req.url, headers: m.QQ_HEADERS, data: JSON.parse(req.body), responseType: 'json' }), 'QQ Music');
      return parse(r.data);
    },

    appleArt: async function (id, storefront) {
      var m = await import('./src/apple-art.js');
      var r = await Http.get({ url: m.appleAlbumPageUrl(id, storefront), headers: m.RELAY_HEADERS, responseType: 'text' });
      if (r.status === 404) return { square: null, tall: null };
      check(r, 'Apple Music');
      return m.extractMotionArt(String(r.data || ''));
    },

    systemMedia: async function (kind, params) {
      if (kind === 'start') {
        if (!subscribed) {
          subscribed = await Native.addListener('nowPlaying', function (s) {
            for (var i = 0; i < listeners.length; i++) listeners[i](s);
          });
        }
        var r = await Native.startNowPlaying();
        return !!(r && r.allowed);
      }
      if (kind === 'stop') { await Native.stopNowPlaying(); return true; }
      if (kind === 'command') { await Native.command({ cmd: String(params && params.cmd || ''), value: Number(params && params.value) || 0 }); return true; }
      return false;
    },

    onSystemMedia: function (fn) { listeners.push(fn); },
  };
})();
