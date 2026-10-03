import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writersOf, pickRecordings } from '../src/songwriters.js';
import { reactionEvents } from '../src/emoji-reactions.js';

test('writers from a MusicBrainz work, without repeats or performers', () => {
  const work = { relations: [
    { type: 'writer', artist: { name: 'Dua Lipa' } },
    { type: 'composer', artist: { name: 'Stephen Kozmeniuk' } },
    { type: 'lyricist', artist: { name: 'Dua Lipa' } },
    { type: 'arranger', artist: { name: 'Someone Else' } },
  ] };
  assert.deepEqual(writersOf(work), ['Dua Lipa', 'Stephen Kozmeniuk']);
});

test('recordings: same title and artist, closest length first', () => {
  const recs = [
    { id: 'a', title: 'Levitating', score: 100, length: 250000, 'artist-credit': [{ name: 'Dua Lipa' }] },
    { id: 'b', title: 'Levitating (feat. DaBaby)', score: 100, length: 203000, 'artist-credit': [{ name: 'Dua Lipa' }] },
    { id: 'c', title: 'Levitating', score: 100, length: 203500, 'artist-credit': [{ name: 'Dua Lipa' }] },
    { id: 'd', title: 'Levitating', score: 100, length: 203000, 'artist-credit': [{ name: 'Cover Band' }] },
  ];
  assert.deepEqual(pickRecordings(recs, { title: 'Levitating', artist: 'Dua Lipa', duration: 203 }).map((r) => r.id), ['b', 'c', 'a']);
});

test('emoji reactions follow sung words', () => {
  const model = { lines: [
    { begin: 1, words: [{ text: 'I', begin: 1 }, { text: 'love', begin: 1.2 }, { text: 'money,', begin: 1.6 }] },
    { begin: 3, text: 'plain line on fire', words: [] },
  ] };
  assert.deepEqual(reactionEvents(model).map((e) => [e.t, e.emoji[0]]), [[1.2, '❤️'], [1.6, '💸'], [3, '🔥']]);
});
