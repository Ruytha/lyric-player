import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildManifest } from '../api/app-update.js';
import { createMesh } from '../src/lyricify-background.js';

const require = createRequire(import.meta.url);
const { WebUpdate, compare, ALLOWED } = require('../desktop/web-update.cjs');
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function site(files) {
  const server = createServer((req, res) => {
    const p = decodeURIComponent(req.url.slice(1));
    if (p in files) { res.end(files[p]); return; }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

async function installed(version) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lp-web-'));
  const bundled = path.join(dir, 'bundled');
  await mkdir(path.join(bundled, 'src'), { recursive: true });
  await writeFile(path.join(bundled, 'index.html'), 'old page');
  await writeFile(path.join(bundled, 'src', 'main.js'), 'same');
  await writeFile(path.join(bundled, 'package.json'), JSON.stringify({ version }));
  return { dir, bundled, data: path.join(dir, 'data') };
}

test('versions compare numerically', () => {
  assert.ok(compare('2.10.0', '2.9.9') > 0);
  assert.equal(compare('2.2.0', '2.2'), 0);
  assert.ok(compare('2.1.9', '2.2.0') < 0);
});

test('only player files can be part of an update', () => {
  for (const ok of ['index.html', 'src/main.js', 'src/vendor/amll-lyrics.css', 'examples/demo.ttml']) assert.ok(ALLOWED.test(ok), ok);
  for (const bad of ['../main.cjs', 'desktop/main.cjs', 'src/../../x.js', 'run.exe', 'node_modules/x.js']) assert.ok(!ALLOWED.test(bad) || bad.includes('..'), bad);
});

test('downloads a newer version, checks every file, uses it from the next start, and rolls back if it fails', async () => {
  const { dir, bundled, data } = await installed('2.2.0');
  const files = { 'index.html': 'new page', 'src/main.js': 'same', 'package.json': JSON.stringify({ version: '2.3.0' }) };
  const s = await site(files);
  try {
    const u = new WebUpdate({ bundledRoot: bundled, dataDir: data, appVersion: '2.2.0' });
    assert.equal(u.usingUpdate, false);
    const m = { version: '2.3.0', minApp: '2.2.0', base: s.base, files: Object.fromEntries(Object.entries(files).map(([p, c]) => [p, sha(c)])) };
    const r = await u.download(m);
    assert.deepEqual(r, { state: 'ready', version: '2.3.0' });
    assert.equal(u.usingUpdate, false, 'not switched mid-session');
    const next = new WebUpdate({ bundledRoot: bundled, dataDir: data, appVersion: '2.2.0' });
    assert.equal(next.usingUpdate, true, 'used from the next start');
    assert.equal(next.version(), '2.3.0');
    assert.equal(await readFile(path.join(next.root, 'index.html'), 'utf8'), 'new page');
    // An update needing a newer app is ignored.
    assert.equal(new WebUpdate({ bundledRoot: bundled, dataDir: data, appVersion: '2.1.0' }).usingUpdate, false);
    // Didn't start: back to the installed files, and that version is skipped.
    assert.equal(next.markBad(), true);
    assert.equal(next.root, bundled);
    assert.equal(new WebUpdate({ bundledRoot: bundled, dataDir: data, appVersion: '2.2.0' }).usingUpdate, false);
  } finally {
    s.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a file that doesn’t match its checksum, or an unexpected path, stops the update', async () => {
  const { dir, bundled, data } = await installed('2.2.0');
  const s = await site({ 'index.html': 'tampered' });
  try {
    const u = new WebUpdate({ bundledRoot: bundled, dataDir: data, appVersion: '2.2.0' });
    await assert.rejects(u.download({ version: '2.3.0', base: s.base, files: { 'index.html': sha('expected') } }), /checksum/);
    await assert.rejects(u.download({ version: '2.3.0', base: s.base, files: { 'desktop/main.cjs': sha('x') } }), /unexpected file/);
    assert.equal(new WebUpdate({ bundledRoot: bundled, dataDir: data, appVersion: '2.2.0' }).usingUpdate, false);
  } finally {
    s.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the website lists the player files with checksums and the version', async () => {
  const m = await buildManifest(path.resolve('.'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(m.version, pkg.version);
  assert.ok(m.files['index.html'] && m.files['src/main.js'] && m.files['apple-ui.css']);
  for (const p of Object.keys(m.files)) assert.ok(ALLOWED.test(p), `${p} would be refused by the app`);
  assert.equal(m.files['src/main.js'], sha(await readFile('src/main.js')));
});

test('Lyricify mesh: subdivided grids like the original (6→21, 9→33 points a side)', () => {
  const p = createMesh(true, 0);
  assert.equal(p.data.length / 6, 21 * 21);
  assert.equal(p.indices.length, 20 * 20 * 6);
  const l = createMesh(false, 4);
  assert.equal(l.data.length / 6, 33 * 33);
  // Corners stay put (boundary corners are kept sharp).
  assert.deepEqual([...p.data.slice(0, 2)], [-1, -1]);
  assert.deepEqual([...l.data.slice(0, 2)].map((v) => Math.round(v * 1000) / 1000), [-1, -1]);
});
