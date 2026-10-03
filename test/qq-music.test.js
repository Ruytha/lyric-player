import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { parseTTML } from '../src/ttml-parser.js';
import { qqTripleDesDecrypt, qqTripleDesEncrypt, decryptQrc, qrcLines, qqToTtml, qqUpstreamRequest } from '../src/qq-music.js';

const hex = (b) => Buffer.from(b).toString('hex').toUpperCase();

test("QQ Music's DES: known answer from a real response, and round trip", () => {
  // First block of a real QRC download decrypts to a zlib header (78 9C …).
  const block = Uint8Array.from(Buffer.from('F966C468621051D6', 'hex'));
  assert.equal(hex(qqTripleDesDecrypt(block)), '789C5D5ADB6E2449');
  const data = Uint8Array.from(Buffer.from('0123456789ABCDEFfedcba98', 'utf8'));
  const copy = data.slice();
  assert.deepEqual(qqTripleDesDecrypt(qqTripleDesEncrypt(copy)), data);
});

const QRC = `<?xml version="1.0" encoding="utf-8"?>
<QrcInfos><LyricInfo LyricCount="1"><Lyric_1 LyricType="1" LyricContent="[ti:Test]
[ar:Someone]
[0,500]Test(0,100) (100,10)-(110,10) (120,10)Someone(130,100)
[500,400]Lyrics(500,26) (526,26)by(552,26)：(578,26)Someone(604,26)
[1000,2000]Hello(1000,500) (1500,10)world(1510,490)
[3000,1500]夜(3000,500)に(3500,500)駆(4000,500)
"/></LyricInfo></QrcInfos>`;

test('encrypted QRC → word-timed TTML (credits and title line skipped)', async () => {
  const z = deflateSync(Buffer.from(QRC, 'utf8'));
  const padded = new Uint8Array(Math.ceil(z.length / 8) * 8);
  padded.set(z);
  const text = await decryptQrc(hex(qqTripleDesEncrypt(padded)));
  assert.equal(text, QRC);
  const lines = qrcLines(text);
  assert.equal(lines.length, 2);
  const model = parseTTML(qqToTtml({ lyric: text, trans: '[00:01.00]你好世界\n[00:00.10]QQ音乐享有本翻译作品的著作权' }));
  assert.equal(model.timing, 'word');
  assert.equal(model.lines[0].text, 'Hello world');
  assert.equal(model.lines[0].words[1].begin, 1.51);
  assert.equal(model.lines[0].translation, '你好世界');
  assert.equal(model.lines[1].text, '夜に駆');
});

test('QQ relay only allows search and lyric requests', () => {
  const s = qqUpstreamRequest('search', { s: 'idol', limit: '5' });
  assert.equal(s.url, 'https://u.y.qq.com/cgi-bin/musicu.fcg');
  assert.equal(JSON.parse(s.body).req.param.query, 'idol');
  assert.equal(JSON.parse(qqUpstreamRequest('lyric', { id: '235175529' }).body).req.param.songID, 235175529);
  assert.throws(() => qqUpstreamRequest('lyric', { id: '1;x' }), /bad id/);
  assert.throws(() => qqUpstreamRequest('other', {}), /unknown/);
});
