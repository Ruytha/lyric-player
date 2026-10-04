import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTrack, appName, SystemPlayback } from '../src/system-media.js';

test('names the app that is playing', () => {
  assert.equal(appName('Spotify.exe'), 'Spotify');
  assert.equal(appName('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App'), 'Apple Music');
  assert.equal(appName('MSEdge'), 'Edge');
  assert.equal(appName('Vivaldi.GFF726DREKLHWQGNBE7FB5XXTQ'), 'Vivaldi');
  assert.equal(appName('SomeStudio.CoolPlayer_x1y2z3w4v5u6'), 'SomeStudio.CoolPlayer');
  assert.equal(appName('C:\\Apps\\Foo\\CoolPlayer.exe'), 'CoolPlayer');
});

test('Apple Music for Windows: "Artist — Album" in the artist field is split', () => {
  const t = normalizeTrack({ app: 'AppleInc.AppleMusicWin_nzyj5cx40ttqa!App', title: 'Equation Of Time', artist: 'Hoogway — Equation Of Time', album: '' });
  assert.deepEqual(t, { title: 'Equation Of Time', artist: 'Hoogway', album: 'Equation Of Time', app: 'Apple Music' });
});

test('Spotify is taken as is', () => {
  const t = normalizeTrack({ app: 'Spotify.exe', title: 'Cruel Summer', artist: 'Taylor Swift', album: 'Lover' });
  assert.deepEqual(t, { title: 'Cruel Summer', artist: 'Taylor Swift', album: 'Lover', app: 'Spotify' });
});

test('browser videos: "Artist - Song (Official Video)" is cleaned up', () => {
  const t = normalizeTrack({ app: 'Chrome', title: 'Tame Impala - The Less I Know The Better (Official Video)', artist: 'TameImpalaVEVO', album: '' });
  assert.equal(t.title, 'The Less I Know The Better');
  assert.equal(t.artist, 'Tame Impala');
  const t2 = normalizeTrack({ app: 'MSEdge', title: 'Idol [Lyrics]', artist: 'YOASOBI - Topic', album: '' });
  assert.equal(t2.title, 'Idol');
  assert.equal(t2.artist, 'YOASOBI');
});

test('position runs on between the app\'s reports, and stops when paused', () => {
  const p = new SystemPlayback();
  p.update({ status: 'Playing', position: 10, updated: 1000, duration: 200, rate: 1 });
  assert.equal(p.position(4000), 13);
  p.update({ status: 'Paused', position: 10, updated: 1000, duration: 200, rate: 1 });
  const paused = p.position();
  assert.ok(paused >= 13, 'counts up to when it paused');
  assert.equal(p.position(Date.now() + 60000), paused, 'and no further');
  p.update({ status: 'Playing', position: 199, updated: 1000, duration: 200, rate: 1 });
  assert.equal(p.position(9000), 200, 'never past the end');
});

test('a stale position re-sent with a new timestamp does not pull the lyrics back', () => {
  const p = new SystemPlayback();
  const song = { app: 'AppleMusic', title: 'Beat It', artist: 'Michael Jackson', duration: 258, rate: 1 };
  p.update({ ...song, status: 'Playing', position: 20, updated: 1000 });
  p.update({ ...song, status: 'Playing', position: 20, updated: 19000 }); // same position, 18 s later
  assert.equal(p.position(19000), 38, 'still 18 s on');
  p.update({ ...song, status: 'Playing', position: 120, updated: 20000 }); // a real seek
  assert.equal(p.position(20000), 120);
  p.update({ ...song, status: 'Paused', position: 125, updated: 25000 });
  p.update({ ...song, status: 'Playing', position: 125, updated: 60000 }); // resumed after a pause
  assert.equal(p.position(60000), 125, 'resuming starts from where it paused');
});
