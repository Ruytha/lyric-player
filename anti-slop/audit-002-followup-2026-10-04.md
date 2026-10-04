# Audit 002 follow-up: website (download page)

Date: 2026-10-04
Approved by the owner: all findings (1-13)
Output: `download/lyricviewer/index.html` (reasons in its header comment), `hero.mp4` (demo song), `find-lyrics.webp`, `apple-mode.webp`
Direction: the owner's direction for Lyric Player's showcase (audit 001): near-black, one cover wash, big wide Archivo words, real app footage. The owner approved the fixes without picking between this and the docs' look; this one was used because it is the direction the owner already chose for the product's public face, and it is recorded here (R-37).

## Findings

| # | Status | What changed |
|---|---|---|
| 1 | Fixed | "Free for Windows and Mac" removed. The meta line is built from `downloads.json`: "Windows 10 and 11" until a Mac file exists. The Mac block says it isn't ready and links to the browser version; its download rows, requirements and first-launch help appear only once a Mac file is listed. |
| 2 | Fixed | "Everything the Apple Music lyrics screen does" removed. The features section states only what the app does, each with a link to the docs. |
| 3 | Fixed | No 40% text left. Secondary text is 72% white: 9.25:1 on the base, 7.49:1 on the wash. |
| 4 | Fixed | No en or em dash anywhere on the page. |
| 5 | Fixed | Orbs removed. One static wash in the demo cover's navy behind the top of the page. |
| 6 | Fixed | No gradient text. The headline lights up like a sung line: bright words, then 50% words (large text, 4.44:1 at the brightest wash). |
| 7 | Fixed | No glow or drop shadows. Media sit on a 1 px hairline. |
| 8 | Fixed | No emoji. |
| 9 | Fixed | The six-card grid is gone: one wide statement, two alternating rows with screenshots (Find lyrics, Apple Music Mode), then a plain two-column list of the rest. |
| 10 | Fixed | Inter removed. Archivo for the big words, the system face (the app's and the docs' face) for text. |
| 11 | Fixed | Nothing pill-shaped: 12 px on controls and download rows, 16 px on media, the phone screenshot 28 px. |
| 12 | Fixed | Same top bar as the docs (icon, name, links), same text face, Docs in the nav, under the features and in the footer. |
| 13 | Fixed | One button: "Download for Windows" (the detected computer's file; "See downloads" when there is none). The second action is a text link with its own destination, the browser version. |

The old promo video (drifting orbs, finding 5) and the unused `screenshot.png` were removed from the site. All footage on the page uses the app's built-in demo song, so no third-party music or covers appear on the public page.

## Delivery Gate

### Block 1: Hard Gate
- R-02 PASS: no em or en dash in the page's text.
- R-03 PASS: captured at 375x812 and 1440x900; no horizontal overflow at either (`scrollWidth > innerWidth` false); download rows and the button are 52-64 px tall.
- R-17 / R-18 / R-28 / R-36 / R-38 PASS: no numbers except version and file sizes from `downloads.json`; no testimonials, no FAQ; every feature named exists in the app.
- R-23 PASS: the app icon is the owner's; screenshots are the app itself.
- R-24 / R-26 PASS, click-through: Skip to content -> #main (exists); Download -> #download; Docs -> /docs/lyricviewer/ (200); What's new -> #whats-new; Open in your browser -> /; Download for Windows -> the MediaFire installer; Installer and Portable rows -> their MediaFire links; Mac rows -> hidden with aria-disabled (no file yet); "Windows protected your PC" details -> opens and closes; Read the docs -> /docs/lyricviewer/.
- R-25 PASS: text-2 9.25:1 (7.49:1 on the wash), dimmed headline words 4.95:1 (4.44:1 on the wash, large text), button text 6.07:1, links 9.33:1 (6.93:1 on the wash).
- R-27 PASS: changelog has loading text and an error message; downloads fall back to "not available yet" and the button to "See downloads".
- R-32 PASS: skip link, visible focus ring (2 px blue outline) on every link and button, native details/summary.
- R-34 N/A: one theme (dark, matching the player and the showcase).
- R-35 PASS: run in the browser at both sizes, no console errors, every element above clicked or inspected.

### Block 2: Purpose-Gate
- R-01 PASS: one wash, reason written (the player tints from the cover).
- R-04 PASS: the only icon is the download arrow, on download actions.
- R-06 PASS: typefaces chosen with written reasons; no tracked uppercase.
- R-08 PASS: the arrow means download and appears only on downloads.
- R-09 PASS: the only label is "This computer", a real detected state, plain text.
- R-10 / R-12 / R-13 PASS: no glass, shadow or glow.
- R-14 PASS: no card grid.
- R-19 PASS: the one motion is the app footage itself; smooth scrolling is off for reduced motion, and the clip shows controls instead of autoplaying.

### Block 3: Liveliness
- Dials: ENERGY 3 / RHYTHM 3 / MOTION 1 for a page (the motion lives in the footage).
- One focal point per screen, whitespace as structure, one accent (the download button), identity motif (headline lit like a lyric line).

### Block 4: Craftsmanship
- C-1 to C-5 PASS; R-05 PASS (statement, alternating rows, list, platform list, changelog: each section built differently); R-11 PASS; R-15 PASS ("Download for Windows"); R-16 PASS; R-20 PASS (shares the docs' frame and the video's type); R-29 PASS (off-black, off-white, one wash, one accent); R-30 PASS; R-31 PASS (header comment).
