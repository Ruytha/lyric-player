# TTML Lyric Player

Made by Ruytha.

Plays a local audio file alongside a word-synced TTML lyrics file, styled like Apple Music's full-screen lyrics view. It's plain HTML, CSS and ES modules with no build step.

## Run

```bash
python -m http.server 5173
```

Open http://localhost:5173. Any static server works, but ES modules don't load from `file://`. To see it without your own files, choose ••• → **Play the demo**. It plays a synthesized track with placeholder lyrics.

**Deploy:** push the folder to Vercel (framework preset "Other", no build command). It's all static files.

**Remote files:** `?audio=<url>&ttml=<url>` (the hosts must allow CORS). Example: `/?ttml=examples/demo.ttml`.

## Tests

```bash
node --test test/ttml-parser.test.js
```

## The window

The app is just the lyrics page. In the desktop app the window has red /
yellow / green buttons top left, like macOS: green is full screen
(Alt+click maximizes), and dragging the top edge moves the window. They
turn grey when the window isn't focused (`src/window-controls.js`,
`apple-ui.css`).

## Controls

The full-screen player follows Apple Music's:
- artwork, title and artist, with Favourite and ••• buttons
- the progress bar with elapsed and remaining time (and a Lossless badge for FLAC/WAV)
- previous, play/pause and next, plus a volume slider
- a bottom row with Lyrics, AirPlay/Cast and Playing Next

AirPlay/Cast appears only in browsers that support the Remote Playback API. Shuffle and Repeat are in Playing Next.

## Shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Seek ±5 s |
| ↑ / ↓ | Volume |
| `[` / `]` | Lyric offset −/+ 50 ms (saved per song) |
| F or F11 | Full screen (also the ⤢ button and the ••• menu) |
| N / P | Next / previous song (previous restarts the song after 3 s) |
| Q | Playing Next |
| Esc | Back to the library from the player |
| M | Apple Music Mode on / off |
| L | Show / hide lyrics (in Apple Music Mode: the Now Playing screen) |
| C | Find album cover |
| / | Find lyrics online |
| E | Edit lyric timing |
| I | Mini player (desktop app) |
| S | Settings |

Tapping ⏮ / ⏭ changes song; holding them seeks 10 s.

You can drag audio, a `.ttml`, or an image onto the player at any time to replace just that part.

## Structure

```
index.html, styles.css
src/main.js          boot, file loading, metadata (jsmediatags via cdnjs), shortcuts, rAF loop
src/ttml-parser.js   TTML → data model (pure; DOMParser in the browser, built-in XML reader in Node)
src/clock.js         interpolated playback clock + offset
src/renderer.js      own renderer, used for untimed lyrics and messages
src/spring.js        damped spring with delayed targets (stagger)
src/player-ui.js     artwork, progress bar, transport, menu
src/background.js    animated blurred artwork background
src/audio-reactor.js music analysis that drives the background
src/library.js       remembered songs (IndexedDB)
src/amll-renderer.js lyrics view using AMLL's DomLyricPlayer (timed lyrics)
src/amll-convert.js  parsed TTML → AMLL LyricLine[]
src/vendor/          bundled AMLL lyric player + mesh background (AGPL-3.0)
src/amll-background.js AMLL mesh-gradient background, fed by the bass analyser
src/settings.js      settings schema, defaults, persistence
src/settings-panel.js the settings sheet
src/liquid-glass.js  refraction filters for glass surfaces
src/lyrics-search.js search AMLL TTML DB + NetEase + LRCLIB, LRC → TTML
src/netease.js       NetEase search/lyrics, YRC → TTML, relay allow-list
api/netease.js       Vercel function relaying NetEase for the website
src/lyrics-search-ui.js the Find lyrics window
src/demo.js          demo track, artwork and TTML (placeholder lyrics)
examples/demo.ttml   the demo TTML as a file
test/                parser unit tests
```

## Font

Lyrics use **SF Pro Display**, Apple Music's typeface, from your local install. Each weight is mapped separately with `local()`, so a missing weight falls back to **Inter**, loaded from Google Fonts, instead of a faked bold. Apple devices already have SF Pro. On Windows, install the SF Pro fonts from https://developer.apple.com/fonts/ (the Bold and Semibold "Display" weights matter most). Apple's font license doesn't allow hosting the font files on a public site, so the app never bundles them.

## Desktop app (Windows .exe)

`desktop/` wraps the same player in its own window with Electron, forcing GPU
rasterization and no background throttling. Builds land in `desktop/dist/`:

- `Lyric-Player-Setup-<version>.exe` installs it with Start menu and desktop shortcuts
- `Lyric-Player-<version>-portable.exe` runs without installing

(Version 1.1.0 was built into `desktop/dist-1.1.0/` because 1.0.0 was open at the time.)

```
cd desktop
npm install
npm start        # run from source
npm run dist     # rebuild the .exe files after changing the player
```

The exe bundles a copy of `index.html`, `styles.css`, `src/` and `examples/`,
so rebuild after changes. It isn't code-signed, so Windows SmartScreen asks once
("More info" → "Run anyway"). The app keeps its own song library, separate from
any browser's.

## Library, queue and playlists

The ☰ button (or Q) slides the Library over the lyrics:

- **Up Next:** the queue, with shuffle and repeat (off, all, one). Drag songs to
  reorder, ••• to remove. Songs play on in order; ⏭ / N skips.
- **Songs:** everything you've added, searchable and sortable by recent, title,
  artist or album. Clicking a song plays the list from there. ••• has Play
  Next, Add to Queue, Add to Playlist, Show in Folder and Forget.
- **Playlists:** make, rename, reorder (drag), play or shuffle them.

The queue and playlists are saved (`src/queue.js`, IndexedDB store
`playlists`).

### Music folders (desktop app)

Library → Songs → **Add music folder…** adds a folder of music (MP3, M4A/AAC,
FLAC, OGG/Opus, WAV, AIFF). Everything in it, including subfolders, shows in
Songs, with tags read by `music-metadata`. Songs play straight from disk, so
there's no 30-song limit. Folders are watched, so new or deleted files show
up by themselves. A `.ttml` file with the same name next to a song is used as
its lyrics. Files are served over a private `media://` address, only from the
folders you added (`desktop/music-folders.cjs`).

### Lyrics found automatically

When a song has no lyrics, the player searches every source (Apple Music when
signed in, AMLL DB, NetEase, QQ Music, LRCLIB). It picks the best match: same
title and artist, within 15 s of the song's length (so live versions and
remixes don't count), word-synced first. They're saved with the song, and a
message says where they came from. Press / to choose different ones. This
can be switched off in Settings → Lyrics (`src/auto-lyrics.js`).

## On This PC: lyrics for Spotify, Apple Music and more (desktop app, Windows)

When another app plays music and Lyric Player isn't playing, the app shows
that song: title, artist, the Apple Music cover (animated when there is one)
and synced lyrics, found the same way as for your own songs. It works with
anything that shows up in Windows' media controls (the volume flyout):
Spotify, Apple Music, TIDAL, Deezer, YouTube Music and browsers. A small
message says which app it is.

- Play / pause, next and previous in the player control that app. Seeking
  works when the app allows it (Spotify doesn't).
- The position comes from the app and runs on in between, so the lyrics
  follow along. If an app reports it a little late, `[` / `]` adjust the
  offset; it's remembered for that song.
- Lyrics found (or picked with /) are kept for the last 25 songs, so they
  come back instantly.
- Apple Music for Windows reports "Artist — Album" as the artist; it's split
  up. Browser video titles like "Artist - Song (Official Video)" are cleaned.
- Playing a song in Lyric Player pauses the other app.

It's switched on and off in Settings → On This PC. It only reads what the app reports to
Windows. The music stays in that app; nothing is recorded or copied. A small
PowerShell helper (`desktop/system-media.ps1`) reads Windows' media controls
and runs only while this is on.

## Your songs are remembered

Every song you drop (audio + its TTML, title, artist and artwork) is saved in
this browser's IndexedDB (`src/library.js`). On reload the last song comes back
automatically, and **Playing Next → Your Songs** lists everything saved: click
to switch, × to forget. Dropping a saved song's audio again brings its lyrics
back too. Nothing leaves your computer; it is per browser, so another browser or
a private window starts empty. The 30 most recent songs are kept.

## Lyricify background

The default background (Settings → Background → Style → **Lyricify**) is the
"Apple Music inspired (iOS)" background from
[Lyricify Backgrounds](https://github.com/WXRIW/Lyricify-Backgrounds) by WXRIW,
ported from Direct3D/HLSL to WebGL 2 (`src/lyricify-background.js`):

1. Three copies of the cover turn slowly over an aspect-filled copy (periods
   of 120, 70 and 90 s; the third turns with the first).
2. A very wide Gaussian blur (sigma 42.5, 77 paired taps), horizontal then
   vertical, on a surface a quarter of the size or smaller.
3. The blurred image is "treated" (saturation up, clamped, down again, 40%
   black) and drawn through a mesh that slowly morphs, a 10-second cycle.
   Behind the lyrics it uses one of Lyricify's mesh presets (4 portrait for
   Apple Music Mode, 5 landscape), picked at random on start; with the lyrics
   hidden it fades to the plain, blurrier version. The bass gently zooms the
   turning layers.

The shader math, blur kernel and mesh control points
(`src/lyricify-mesh-data.js`) are taken from the original. It's under the
Apache License 2.0 (`src/vendor/LICENSE-Lyricify-Backgrounds.txt`). Flow speed,
Music reaction, Beat pulse, Dim, Render quality, Frame rate and Still work
with it too. The other styles (AMLL mesh, Blurred) are still there.

## Reactive background

While a song plays, the blurred artwork pulses with the kick drum, flows faster
and gets brighter when the music is loud (`src/audio-reactor.js`, Web Audio
`AnalyserNode`). Levels auto-adjust to each song's loudness. Toggle it in the
••• menu ("Background reacts to music"); it defaults to off when the system asks
for reduced motion.

It only hooks up for local files and same-origin URLs. A cross-origin `?audio=`
URL without CORS headers would play silently through Web Audio, so those play
with a non-reactive background.

## Find lyrics online

Press `/`, use ••• → **Find lyrics online…**, or **Search lyrics online** on the
start screen. Type a title and artist, then pick a result; the lyrics load and
are saved with the current song. No Apple developer account is needed:

- **AMLL TTML DB** ([amll-dev/amll-ttml-db](https://github.com/amll-dev/amll-ttml-db),
  CC0): community-made, word-synced TTML in Apple Music's format, with
  background vocals and duets. Its index (~1.6 MB) is downloaded once per session
  and searched locally. Results show the contributor who made each file.
- **BiniLyrics** ([lyrics.binimum.org](https://lyrics.binimum.org/developers)):
  a free lyrics API with TTML in Apple Music's format, word- or line-timed.
  No key, and it allows requests from any site, so it's called directly
  (`src/binilyrics.js`). Its search isn't ranked, so results are ranked here;
  the lyric files are only fetched from its own host.
- **NetEase Cloud Music**: many songs word-synced (its YRC format), often
  with a translation, converted to TTML (`src/netease.js`). NetEase has no
  public API and blocks cross-site requests, so requests go through a relay
  that only forwards its search and lyric endpoints: the Electron main process
  in the desktop app, or the Vercel function `api/netease.js` on the deployed
  site. It isn't available on a plain static server (like the local preview).
  This uses NetEase's private API, as AMLL Player and other players do; it
  can change or stop working at any time.
- **QQ Music**: word-synced lyrics (its QRC format) for a lot of songs, with
  Chinese translations, converted to TTML (`src/qq-music.js`). QRC downloads
  are encrypted with QQ Music's own, slightly broken triple DES and then
  zlib-compressed; the decryption is a port of
  [wangqr/QQMusicDES](https://github.com/wangqr/QQMusicDES) (MIT). Requests
  go through a relay like NetEase's (`api/qq-music.js` on the website). This
  is QQ Music's private API too and can stop working at any time.
- **LRCLIB** ([lrclib.net](https://lrclib.net)): a large open database of
  line-synced lyrics, converted to TTML (`lrcToTtml` in `src/lyrics-search.js`;
  enhanced LRC word timings are kept).
- **Apple Music** (desktop app, your own subscription): see below.

### Apple Music lyrics (desktop app)

Settings → Apple Music → **Sign in to Apple Music…** opens music.apple.com in
an app window. You sign in there, on Apple's own page, then close the window.
After that, Find lyrics shows Apple Music's own word-synced TTML first. You
can turn that off with *Apple Music lyrics in Find lyrics*.

The app never sees your password or tokens. The Apple Music page keeps
running hidden in its own session (`persist:apple-music`), and lyrics are
fetched by asking the web player's MusicKit for them, the same request it
makes when you open lyrics on the website. It needs an active Apple Music
subscription. Apple doesn't officially support using its web player this
way, so it's at your own risk, and it can break if Apple changes the site.
**Sign out** clears that session.

## Last.fm (desktop app)

Settings → Last.fm scrobbles what you play:

1. Make a free API account at <https://www.last.fm/api/account/create>.
   Any name works, and the callback URL can stay empty.
2. Paste its **API key** and **shared secret** in Settings, then click
   **Connect to Last.fm…** and approve it in your browser.

The app sends "now playing" when a song starts. It scrobbles once you've
heard half the song or 4 minutes, whichever comes first. Seeking doesn't
count, and songs under 30 seconds are skipped. The session key stays in the
app's own data folder, and requests are signed in the main process
(`desktop/lastfm.cjs`, `src/scrobbler.js`).

## Discord Rich Presence (desktop app)

Shows the song on your Discord profile as "Listening to …", with the artist,
a progress bar with the song length, and the cover, which can be animated.

1. Go to <https://discord.com/developers/applications> → **New Application**.
   Its name is what Discord shows, e.g. "Lyric Player". Copy its
   **Application ID**.
2. In Settings → Discord, turn on **Discord Rich Presence** and paste the ID.
   The Discord desktop app has to be running.

Everything is editable in Settings:

| Setting | Default | |
| --- | --- | --- |
| First line | `{title}` | `{title}`, `{artist}` and `{album}` work in any of the text fields |
| Second line | `{artist}` | |
| Cover hover text | `{album}` | |
| Song length and progress | on | the progress bar under the presence |
| Show while paused | off | otherwise the presence clears on pause |
| Cover | Animated | Animated, Still or None |
| Website for animated covers | (empty) | see below |

Discord only shows images from public web addresses and can't play video.
The still cover is Apple's artwork URL, so it works out of the box. An
animated cover has to be converted to a GIF first. `api/cover-gif.js` does
that on your deployed Vercel site, using ffmpeg (`ffmpeg-static`) on the
smallest H.264 version of the cover video: a 6-second, 160 px loop of about
0.7 MB, cached by Vercel's CDN. Put the site's address (e.g.
`https://your-site.vercel.app`) in *Website for animated covers*. The app
fetches each GIF once before handing it to Discord, so the first conversion
(a few seconds) doesn't time out.

The connection is Discord's local IPC pipe (`desktop/discord-rpc.cjs`, no
dependencies). Updates are throttled to one every 4 seconds, which is
Discord's limit.

## Edit lyric timing

••• → **Edit lyric timing…** (or E) opens the sync editor. Pick a line, play
the song and press **T** (or Tap) the moment it starts. The line moves there,
words and background vocals included, and the next line is picked, so you
can tap through a whole song. Lines can also be nudged ±50 ms (`[` `]`), set
to now (⏱), or all shifted at once. Changes preview live. **Save** keeps
them with the song; **Export .ttml** downloads the file. Only the times are
edited (`src/ttml-edit.js`), so everything else in the TTML stays as it was.

## Lyric cards

••• → **Share lyric card…** makes an image of up to 6 lines (with their
translation if you like) on the cover's colours, with the cover, title and
artist. You can save it as a PNG or copy it (`src/lyric-card.js`).

## Mini player (desktop app)

••• → **Mini player** (or I) opens a small always-on-top window with the line
being sung, lit word by word, plus the next line, the cover and a progress
bar. Hovering shows previous / play / next, back to the player, and close.

## Apple Music Mode

••• → **Apple Music Mode** (or press M) switches to the iPhone lyrics screen:
a portrait layout with a small cover, title and artist at the top and the
lyrics filling the rest. Playback controls slide up when you move the mouse
and hide again after a few seconds. In the desktop app the window turns into
a phone-shaped window and goes back to its old size when you switch the mode
off. In a browser the layout is a centred column. It works in full screen too.

Hiding the lyrics (the lyrics button or L) in Apple Music Mode shows the
**Now Playing** screen, like the iPhone: big cover, title and full controls.
When the album has a tall animated cover, it plays full-bleed behind
everything, the way iOS shows it.

## Animated album covers

Apple Music's moving covers play in the artwork box when the album has one.

- **Automatic:** when a song with a title and artist is added, the player
  looks it up on Apple Music (Settings → Artwork → *Find covers
  automatically*). If it finds the album, it plays the animated cover, and
  uses Apple's still cover when the file has no artwork of its own. The
  result is saved with the song.
- **Search:** ••• → **Find album cover…** (or press C) lists matching albums
  and marks the ones with an animated cover. Picking one uses it for the
  current song. ••• → **Use still cover** turns the motion off for a song.

How: albums come from the free iTunes Search API. The animated cover is an
HLS video listed on the album's public music.apple.com page. That page
doesn't allow cross-site requests, so a relay reads it and returns only the
video links: the desktop app's main process, or `api/apple-art.js` on
Vercel. The local static preview has no relay, so only still covers work
there. The video plays with [hls.js](https://github.com/video-dev/hls.js)
(Apache-2.0, vendored in `src/vendor/hls.light.min.js`). This relies on how
Apple's web pages are built today, so it may need updating if Apple changes
them.

## Updates, source check and diagnostics

Settings → About shows the version and has three tools:

- **In-app updates** (desktop app): the app updates itself from **your
  website**, with no reinstall. Put your deployed site's address in
  Settings → About → **Your website** (for example
  `https://your-site.vercel.app`). On each start the app asks the site's
  `/api/app-update` for the list of player files with their SHA-256. When the
  site has a newer version (the `version` in the root `package.json`), it
  downloads only the files that changed and checks each one. It then uses the
  new version from the next start, or right away with About → **Use it now**.
  To publish an update: change the files, raise `version` in `package.json`,
  and redeploy the site. An update that doesn't start within 20 seconds is
  rolled back to the installed version and skipped. In-app updates cover
  everything in the player (HTML, CSS, JavaScript). Changes to the desktop
  shell (`desktop/*.cjs`) still need a new installer, so raise
  `lyricPlayer.minApp` in `package.json` when an update depends on one. Older
  apps then say an update needs the new installer (`desktop/web-update.cjs`,
  `api/app-update.js`).
- **Check for updates** (full installer updates): uses `electron-updater` with GitHub
  Releases. To turn it on, set `build.publish` in `desktop/package.json` to
  your repository (`{ "provider": "github", "owner": "you", "repo": "lyric-player" }`).
  Then publish a release with `npx electron-builder --win nsis --publish always`,
  with `GH_TOKEN` set. Installed copies check 15 s after starting, download
  when you click, and install on restart. Until it's set up, About says
  updates aren't configured.
- **Check sources:** tries AMLL DB, NetEase, QQ Music, LRCLIB, Apple covers
  and, if you're signed in, Apple Music lyrics. It shows which work and how
  fast. The private APIs can break without warning, and this shows it at a
  glance.
- **Copy diagnostics:** copies a report with versions, GPU, settings
  (secrets hidden), the last source check and recent errors.

## Settings, background and Liquid Glass

Open **Settings** with the sliders button under the controls, the ••• menu, or
`S`. Changes apply live and are saved in the browser/app. Double-click a slider
to reset it.

- **Lyrics:** size, weight, letter spacing, **bloom** (glow around the line
  being sung), sweep softness, focus position, blur/zoom/spring toggles, hide
  sung lines, translation, romanization.
- **Background:** AMLL's WebGL mesh gradient (default) or our blurred artwork,
  plus flow speed, music reaction, beat pulse, dim, render quality, frame rate
  and a still mode. It falls back to blurred artwork without WebGL.
- **Liquid Glass:** buttons, menus, toasts and the settings sheet are glass
  with bright rims. In Chromium (Chrome, Edge, the desktop app) each surface
  also refracts what's behind it through a per-element SVG displacement map
  (`src/liquid-glass.js`). Other browsers get frosted glass without the bend.

## Lyrics engine (AMLL) and license

Timed lyrics are rendered by AMLL's own lyric player, `DomLyricPlayer` from
[`@applemusic-like-lyrics/core`](https://github.com/amll-dev/applemusic-like-lyrics)
0.6.0, the same engine used in AMLL Player and AMLL Tool. This gives its line
scaling, springs, word sweep, held-word swell and interlude dots exactly.

- `src/vendor/amll-lyrics.js` / `.css` is a single-file build of just the lyric
  player (its Pixi background is stubbed out). Rebuild or upgrade it with
  `sh scripts/build-amll.sh [version]`.
- `src/amll-convert.js` turns our parsed TTML into AMLL's line format;
  `src/amll-renderer.js` feeds it the clock every frame and handles seeking.
- Untimed lyrics and the empty-state messages still use our own renderer
  (`src/renderer.js`).

AMLL is licensed **AGPL-3.0-only**, so this project, which includes it, is
distributed under AGPL-3.0 too (see `LICENSE`). If you host it publicly, keep
its source available to visitors. The deployed site serves its own source as
plain files, and linking to the repository covers the rest.

## Implementation notes

`src/renderer.js` (the fallback renderer) follows AMLL's behaviour and parameters:

- **Sweep:** text is white, and an alpha mask on each word dims it (sung 1.0, unsung 0.4, inactive lines 0.25). One soft front (0.6em wide) crosses the whole line, so the edge carries across word gaps.
- **Rise:** sung words rise 0.05em over max(1 s, word duration). Background vocals rise twice as far.
- **Emphasis:** words held ≥ 1 s (2–7 letters, or any CJK) swell, spread, lift and glow letter by letter. Strength grows with the hold, and the last word of a line is boosted.
- **Scroll:** the focus line's centre sits at 35%. Each line has its own spring for position and another for scale (0.97 → 1). Both start in a top-to-bottom cascade 50 ms apart. The springs are solved analytically: velocity carries over when a target changes, and any damping at or above critical behaves as exactly critical. That reproduces the reference curve: 50% of the move at ~110 ms and 90% at ~265 ms, with no overshoot. Line pitch is 2.2em.
- **Manual scrolling:** the wheel and trackpad glide to an accumulated target. Dragging follows the pointer 1:1, flings coast with iOS-style deceleration, and pulling past either end rubber-bands and springs back. Auto-follow glides back 3 s after the last touch.
- **Blur:** 1 px + 1 px per line of distance, capped at 5 px. Hovering or scrolling removes it.
- **Background vocals:** collapsed until their line is sung, then they unfold and push the following lines down.
- **Interlude dots:** breathe 1 → 1.25, light up one after another, then swell and collapse just before the next line.
- **Background:** three rotating copies of the cover are drawn into a canvas at 1/12 resolution and upscaled. That's cheaper than full-screen CSS blur layers.
- `window.lyricPlayer` exposes the audio element, clock and renderer for console debugging.
