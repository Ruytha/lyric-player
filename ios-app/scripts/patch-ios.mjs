// After `npx cap add ios`: the app's icon and launch image, its version, and
// the iPhone settings it needs (Info.plist):
//  - NSAppleMusicUsageDescription: asked once, to follow the Music app;
//  - UIBackgroundModes audio: your own songs keep playing when locked;
//  - light status bar text on the dark player.
// Safe to run again.

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const ios = path.join(app, 'ios', 'App');
const version = JSON.parse(await readFile(path.join(app, '..', 'package.json'), 'utf8')).version;

// Icon and launch image
await copyFile(path.join(app, 'resources', 'AppIcon-1024.png'), path.join(ios, 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'));
for (const f of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  await copyFile(path.join(app, 'resources', 'splash-2732.png'), path.join(ios, 'App', 'Assets.xcassets', 'Splash.imageset', f));
}

// Info.plist
const plistPath = path.join(ios, 'App', 'Info.plist');
let plist = await readFile(plistPath, 'utf8');
const entries = {
  NSAppleMusicUsageDescription: '<string>Lyric Player shows the lyrics of the song playing in the Music app, in time, and lets you play, pause and skip it.</string>',
  UIBackgroundModes: '<array>\n\t\t<string>audio</string>\n\t</array>',
  ITSAppUsesNonExemptEncryption: '<false/>',
  UIStatusBarStyle: '<string>UIStatusBarStyleLightContent</string>',
  UIViewControllerBasedStatusBarAppearance: '<false/>',
};
for (const [key, value] of Object.entries(entries)) {
  if (plist.includes(`<key>${key}</key>`)) continue;
  plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${key}</key>\n\t${value}\n</dict>\n</plist>\n`);
}
// The template lets each screen pick its status bar; the player is always dark.
plist = plist.replace(/(<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*)<true\/>/, '$1<false/>');
await writeFile(plistPath, plist);

// Version shown in Settings and to Xcode
const pbxPath = path.join(ios, 'App.xcodeproj', 'project.pbxproj');
let pbx = await readFile(pbxPath, 'utf8');
pbx = pbx.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`);
await writeFile(pbxPath, pbx);

console.log(`iOS project ready (version ${version})`);
