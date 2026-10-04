import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessStorefront, formatPrice, toSong, ttmlFileName } from '../src/catalog.js';

test('catalog: storefront from the browser language', () => {
  assert.equal(guessStorefront(['en-AU', 'en']), 'au');
  assert.equal(guessStorefront(['ja-JP']), 'jp');
  assert.equal(guessStorefront(['en']), 'us');
  assert.equal(guessStorefront([]), 'us');
});

test('catalog: price, or null when not for sale', () => {
  assert.equal(formatPrice(1.29, 'USD', 'en-US'), '$1.29');
  assert.equal(formatPrice(-1, 'USD', 'en-US'), null);
  assert.equal(formatPrice(1.29, '', 'en-US'), null);
});

test('catalog: iTunes song result → song', () => {
  const s = toSong({
    kind: 'song', trackId: 42, collectionId: 7, trackName: 'Cake By the Ocean', artistName: 'DNCE', collectionName: 'DNCE',
    releaseDate: '2015-09-18T07:00:00Z', primaryGenreName: 'Pop', trackTimeMillis: 219000, trackExplicitness: 'explicit',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/b/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a',
    trackViewUrl: 'https://music.apple.com/us/album/cake-by-the-ocean/7?i=42&uo=4', trackPrice: 1.29, currency: 'USD',
  });
  assert.equal(s.title, 'Cake By the Ocean');
  assert.equal(s.year, '2015');
  assert.equal(s.duration, 219);
  assert.equal(s.explicit, true);
  assert.match(s.artwork, /600x600bb\.jpg$/);
  assert.match(s.appleMusicUrl, /[?&]i=42/);
  assert.match(s.appleMusicUrl, /[?&]app=music/);
  assert.match(s.storeUrl, /[?&]app=itunes/);
  assert.ok(s.price);
});

test('catalog: .ttml file name is safe', () => {
  assert.equal(ttmlFileName({ title: 'What?/Why', artist: 'A:B' }), 'AB - WhatWhy.ttml');
  assert.equal(ttmlFileName({}), 'lyrics.ttml');
});
