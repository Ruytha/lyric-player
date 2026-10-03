import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// index.html's player column: a stray </div> once pushed the controls out of
// it, so the cover slid off the left edge.
test('index.html: divs balance and the player column holds its parts', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const parentOf = {};
  for (const m of html.matchAll(/<(\/?)div\b([^>]*)>/g)) {
    if (m[1]) { assert.ok(stack.length, `extra </div> at ${m.index}`); stack.pop(); continue; }
    const cls = /class="([^"]*)"/.exec(m[2])?.[1] || '';
    const id = /id="([^"]*)"/.exec(m[2])?.[1] || '';
    for (const key of [...cls.split(/\s+/).filter(Boolean).map((c) => `.${c}`), id && `#${id}`].filter(Boolean)) parentOf[key] ??= [...stack];
    stack.push(cls.split(/\s+/)[0] ? `.${cls.split(/\s+/)[0]}` : `#${id}`);
  }
  assert.equal(stack.length, 0, `unclosed divs: ${stack.join(' > ')}`);
  for (const part of ['#controls', '#menu', '.meta']) assert.ok(parentOf[part]?.includes('.player-inner'), `${part} is inside .player-inner`);
});
