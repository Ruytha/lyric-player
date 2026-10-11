// Copies the player (the repo's web files) into www/ for the Android app and
// adds the Android bridge (web/android-native.js) before the page's modules.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const repo = path.resolve(app, '..');
const www = path.join(app, 'www');

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });
for (const f of ['index.html', 'styles.css', 'apple-ui.css', 'package.json']) await cp(path.join(repo, f), path.join(www, f));
for (const d of ['src', 'examples']) await cp(path.join(repo, d), path.join(www, d), { recursive: true });
await cp(path.join(app, 'web', 'android-native.js'), path.join(www, 'android-native.js'));

const page = path.join(www, 'index.html');
let html = await readFile(page, 'utf8');
const tag = '<script src="android-native.js"></script>\n  ';
if (!html.includes('android-native.js')) html = html.replace('<script type="module" src="src/main.js"></script>', `${tag}<script type="module" src="src/main.js"></script>`);
if (!html.includes('android-native.js')) throw new Error('could not add android-native.js to index.html');
await writeFile(page, html);
console.log(`Copied the player into ${path.relative(process.cwd(), www) || 'www'}`);
