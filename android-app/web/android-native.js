// Android app (Capacitor): gives the player a `lyricPlayerNative` bridge for
// the lookups a web page can't make itself (NetEase, QQ Music, Apple Music
// album pages), sent with native networking. "Music playing on this phone"
// isn't available on Android, so systemMedia reports itself as unsupported.
(function () {
  var C = window.Capacitor;
  if (!C || !C.getPlatform || C.getPlatform() !== 'android') return;
  // Same phone layout as the iPhone app (Apple Music Mode, mobile settings).
  document.documentElement.classList.add('ios', 'android');

  var Http = C.registerPlugin('CapacitorHttp');

  function parse(data) {
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (e) { return data; }
  }
  function check(r, name) {
    if (r.status >= 400) throw new Error(name + ' HTTP ' + r.status);
    return r;
  }

  window.lyricPlayerNative = {
    platform: 'android',

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

    systemMedia: async function () { return false; },
    onSystemMedia: function () {},
  };
})();
