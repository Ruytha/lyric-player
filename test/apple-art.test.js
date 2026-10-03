import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMotionArt, appleAlbumPageUrl, albumMatch, artworkAt } from '../src/apple-art.js';

const SQ = 'https://mvod.itunes.apple.com/itunes-assets/HLSMusic126/v4/a7/41/f8/a741f8f3/P376780144_default.m3u8';
const TALL = 'https://mvod.itunes.apple.com/itunes-assets/HLSMusic116/v4/29/05/02/290502ac/P376780139_default.m3u8';

test('finds the square and tall animated covers on an album page', () => {
  const html = `<script type="application/json" id="serialized-server-data">{"editorialVideo":{`
    + `"motionDetailTall":{"previewFrame":{"bgColor":"0e0a13","url":"https://is1-ssl.mzstatic.com/x/{w}x{h}bb.{f}","width":2048},"video":"${TALL}"},`
    + `"motionDetailSquare":{"previewFrame":{"bgColor":"54455f","height":3840,"url":"https://is1-ssl.mzstatic.com/y/{w}x{h}bb.{f}"},"video":"${SQ}"}}}</script>`;
  assert.deepEqual(extractMotionArt(html), { square: SQ, tall: TALL });
});

test('falls back to the page player; ignores other hosts; none → nulls', () => {
  assert.deepEqual(extractMotionArt(`<amp-ambient-video class="editorial-video" src="${SQ}"></amp-ambient-video>`), { square: SQ, tall: null });
  assert.deepEqual(extractMotionArt('"motionDetailSquare":{"previewFrame":{},"video":"https://evil.example/x.m3u8"}'), { square: null, tall: null });
  assert.deepEqual(extractMotionArt('<html>no video</html>'), { square: null, tall: null });
});

test('relay only fetches album pages', () => {
  assert.equal(appleAlbumPageUrl('1440838039'), 'https://music.apple.com/us/album/1440838039');
  assert.equal(appleAlbumPageUrl('1440838039', 'GB'), 'https://music.apple.com/gb/album/1440838039');
  assert.throws(() => appleAlbumPageUrl('1/../../x'), /bad id/);
  assert.throws(() => appleAlbumPageUrl('123', 'usa'), /bad storefront/);
});

test('album matching by title and artist', () => {
  const r = { song: 'New Person, Same Old Mistakes', artist: 'Tame Impala', album: 'Currents' };
  assert.ok(albumMatch(r, { title: 'New Person, Same Old Mistakes', artist: 'Tame Impala' }) >= 0.9);
  assert.ok(albumMatch(r, { title: 'new person same old mistakes (Remastered)', artist: 'tame impala' }) >= 0.9);
  assert.equal(albumMatch(r, { title: 'New Person, Same Old Mistakes', artist: 'Rihanna' }), 0);
  assert.equal(albumMatch(r, { title: 'Let It Happen', artist: 'Tame Impala' }), 0);
});

test('artwork URLs at a chosen size', () => {
  assert.equal(artworkAt('https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/100x100bb.jpg', 1000), 'https://is1-ssl.mzstatic.com/image/thumb/a/b.jpg/1000x1000bb.jpg');
});
