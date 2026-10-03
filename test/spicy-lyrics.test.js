import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spicyToTtml, readCredit, isExpired, mayExport, SPICY_MAX_AGE } from '../src/spicy-lyrics.js';
import { parseTTML } from '../src/ttml-parser.js';
import handler, { pickTrack } from '../api/spicy-lyrics.js';

// The shape Spicy Lyrics answers with (developers.spicylyrics.org, and the
// types in its open-source extension). Times are in seconds.
const syllableAnswer = {
  Body: {
    Type: 'Syllable',
    StartTime: 1.0,
    EndTime: 9.0,
    SongWriters: ['Someone'],
    source: 'spicy_lyrics',
    UploadAttribution: {
      Uploader: { id: 'u1', username: 'upper', avatar: '', url: 'https://spicylyrics.org/u/upper' },
      Maker: { id: 'm1', username: 'maker & co', avatar: '', url: 'https://spicylyrics.org/u/maker' },
    },
    Content: [
      { Type: 'Vocal', OppositeAligned: false, Lead: { StartTime: 1.0, EndTime: 3.0, Syllables: [
        { Text: 'Hel', StartTime: 1.0, EndTime: 1.3, IsPartOfWord: true },
        { Text: 'lo', StartTime: 1.3, EndTime: 1.6, IsPartOfWord: false },
        { Text: 'world', StartTime: 1.7, EndTime: 3.0, IsPartOfWord: false },
      ] }, Background: [{ StartTime: 2.0, EndTime: 3.4, Syllables: [{ Text: 'ooh', StartTime: 2.0, EndTime: 3.4 }] }] },
      { Type: 'Vocal', OppositeAligned: true, Lead: { StartTime: 4.0, EndTime: 6.0, Syllables: [
        { Text: '愛', TransliteratedText: 'ai', StartTime: 4.0, EndTime: 5.0, IsPartOfWord: false },
        { Text: 'してる', TransliteratedText: 'shiteru', StartTime: 5.0, EndTime: 6.0, IsPartOfWord: false },
      ] } },
    ],
  },
  Status: 200,
  Type: 'object',
};

test('Spicy Lyrics syllable sync → TTML the player reads: words, background, duet, romanization', () => {
  const ttml = spicyToTtml(syllableAnswer, { title: 'Song', artists: ['Artist'], fetched: 1000 });
  const m = parseTTML(ttml);
  assert.equal(m.timing, 'word');
  assert.equal(m.lines.length, 2);
  assert.equal(m.lines[0].text, 'Hello world');
  assert.equal(m.lines[0].words.length, 2, 'Hel + lo are one word');
  assert.ok(m.lines[0].background, 'background vocal kept');
  assert.equal(m.lines[1].romanization, 'ai shiteru');
  assert.ok(m.lines[1].isDuet || m.lines[1].agent === 'v2', 'opposite-aligned line is the other singer');
  assert.equal(m.meta.title, 'Song');
});

test('line and static lyrics', () => {
  const line = parseTTML(spicyToTtml({ Type: 'Line', source: 'aml', Content: [{ Text: 'One line', StartTime: 2, EndTime: 4 }] }));
  assert.equal(line.lines[0].text, 'One line');
  assert.equal(line.timing, 'line');
  const stat = parseTTML(spicyToTtml({ Type: 'Static', source: 'spt', Lines: [{ Text: 'No timing' }] }));
  assert.equal(stat.timing, 'none');
  assert.throws(() => spicyToTtml({ Type: 'Line', Content: [] }), /no lines/);
});

test('the credit travels with the lyrics, and community syncs credit their people', () => {
  const ttml = spicyToTtml(syllableAnswer, { fetched: 1234 });
  const c = readCredit(ttml);
  assert.equal(c.provider, 'Spicy Lyrics');
  assert.equal(c.source, 'community');
  assert.deepEqual(c.uploader, { name: 'upper', url: 'https://spicylyrics.org/u/upper' });
  assert.equal(c.maker.name, 'maker & co');
  assert.equal(c.fetched, 1234);
  const apple = readCredit(spicyToTtml({ Type: 'Line', source: 'aml', Content: [{ Text: 'x', StartTime: 0, EndTime: 1 }] }));
  assert.equal(apple.source, 'apple');
  assert.equal(apple.uploader, null, 'no empty uploader line for Apple Music / Spotify syncs');
  assert.equal(readCredit('<tt><body/></tt>'), null);
});

test('kept at most 30 days, and never exported', () => {
  const c = readCredit(spicyToTtml(syllableAnswer, { fetched: 1_000_000 }));
  assert.equal(isExpired(c, 1_000_000 + SPICY_MAX_AGE - 1), false);
  assert.equal(isExpired(c, 1_000_000 + SPICY_MAX_AGE + 1), true);
  assert.equal(isExpired(null), false);
  assert.equal(mayExport(c), false);
  assert.equal(mayExport(null), true);
});

test('the right song on Spotify', () => {
  const t = (id, name, artist, ms) => ({ id, name, artists: [{ name: artist }], duration_ms: ms });
  const results = [t('a', 'Levitating (feat. DaBaby)', 'Dua Lipa', 203064), t('b', 'Levitating', 'Dua Lipa', 203807), t('c', 'Levitating', 'Someone Else', 180000)];
  assert.equal(pickTrack(results, { title: 'Levitating', artist: 'Dua Lipa', duration: 203.8 }).id, 'b');
  assert.equal(pickTrack(results, { title: 'Levitating (feat. DaBaby)', artist: 'Dua Lipa' }).artists[0].name, 'Dua Lipa');
  assert.equal(pickTrack(results, { title: 'Levitating', artist: 'Nobody' }), null);
  assert.equal(pickTrack(results, { title: 'Levitating', artist: 'Dua Lipa', duration: 400 }), null, 'a different version');
});

const KEYS = { SPICY_LYRICS_KEY: 'sl_sk_test', SPOTIFY_CLIENT_ID: 'cid', SPOTIFY_CLIENT_SECRET: 'csec' };
function call(url, { origin = 'app://player', env = KEYS, fetches = {} } = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  if (!env.SPICY_LYRICS_KEY) delete process.env.SPICY_LYRICS_KEY;
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (u, init) => {
    seen.push({ u: String(u), auth: init?.headers?.Authorization });
    if (String(u).includes('accounts.spotify.com')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    const hit = Object.entries(fetches).find(([k]) => String(u).includes(k));
    const [status, body] = hit ? hit[1] : [404, {}];
    return { status, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const res = { headers: {}, code: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  return handler({ method: 'GET', url, headers: origin ? { origin } : {} }, res).then(() => {
    globalThis.fetch = realFetch;
    process.env = saved;
    return { res, seen };
  });
}

test('website endpoint: Spotify search → Spicy Lyrics, keys stay on the server', async () => {
  const { res, seen } = await call('/api/spicy-lyrics?title=Levitating&artist=Dua%20Lipa&duration=203', {
    fetches: {
      'api.spotify.com/v1/search': [200, { tracks: { items: [{ id: '463CkQjx2Zk1yXoBuierM9', name: 'Levitating', artists: [{ name: 'Dua Lipa' }], album: { name: 'Future Nostalgia' }, duration_ms: 203807 }] } }],
      'api.spicylyrics.org/v1/lyrics/463CkQjx2Zk1yXoBuierM9': [200, syllableAnswer],
    },
  });
  assert.equal(res.code, 200);
  assert.equal(res.body.found, true);
  assert.equal(res.body.spotifyId, '463CkQjx2Zk1yXoBuierM9');
  assert.equal(res.body.album, 'Future Nostalgia');
  assert.ok(parseTTML(res.body.ttml).lines.length === 2);
  assert.equal(res.headers['access-control-allow-origin'], 'app://player');
  assert.equal(seen.find((s) => s.u.includes('spicylyrics')).auth, 'Bearer sl_sk_test');
  assert.equal(seen.find((s) => s.u.includes('api.spotify.com')).auth, 'Bearer tok');
  assert.ok(!JSON.stringify(res.body).includes('sl_sk_test'), 'the key never goes to the app');
});

test('website endpoint: other sites, no key, not found', async () => {
  assert.equal((await call('/api/spicy-lyrics?title=x', { origin: 'https://evil.example' })).res.code, 403);
  assert.equal((await call('/api/spicy-lyrics?title=x', { env: {} })).res.code, 501);
  assert.equal((await call('/api/spicy-lyrics?title=x', { env: { SPICY_LYRICS_KEY: 'k' } })).res.code, 501, 'Spotify keys missing');
  const nf = await call('/api/spicy-lyrics?spotifyId=463CkQjx2Zk1yXoBuierM9', { fetches: { 'api.spicylyrics.org': [404, {}] } });
  assert.equal(nf.res.body.found, false);
});
