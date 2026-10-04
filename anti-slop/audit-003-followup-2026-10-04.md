# Audit 003 follow-up: app UI

Date: 2026-10-04
Approved by the owner: all findings (1-8), with the suggested scope for 6 (glass kept on the player buttons, menus and panels; small controls inside panels solid)
Released as 2.12.0 (web update; no new installer needed)

## Findings

| # | Status | What changed |
|---|---|---|
| 1 | Fixed | Two tokens in `styles.css`: `--label-2` (80% white) for all secondary text, `--label-3` (66%) for icons, placeholders and large bold text. About 45 rules moved from 30-55% white to them (`styles.css`, `apple-ui.css`); `--muted` and `--faint` now point at `--label-2`. Large glass panels (menus, sheets, toasts) went from a 42% to a 76% dark tint and the search panel from 50% to 76%, Apple's "larger elements are more opaque" rule. Unlit lyric lines and translation lines under them keep their dim state on purpose. |
| 2 | Fixed | Focus is visible everywhere: window buttons (2 px white ring), search bar (`:focus-within` ring), slider thumbs, text fields and the quiz field (2 px, 85-90% white), the global ring raised from 70% to 90%. |
| 3 | Fixed | 9 px repeat-one digit now 10 px; the 10 px drop hint now 11 px; source names 11.5 to 12 px. |
| 4 | Fixed | The 12 messages rewritten without dashes ("No lyrics found for this song. Press / to search yourself.", "Couldn't look for lyrics. Are you offline? Press / to search.", "Welcome back: ..."); window, mini player and phone remote titles use "·". The diagnostics report uses ":". |
| 5 | Fixed | `prefers-reduced-transparency`: blur off everywhere and solid panels, and Liquid Glass switches itself off (`liquid-glass.js`, live when the system setting changes). `prefers-contrast: more`: secondary text white, unlit lyrics 55%, 1 px edges on panels and controls. |
| 6 | Fixed | Glass (and refraction) only on round player buttons, icon buttons, menus, sheets, toasts and search panels. Toggles, stepper buttons, sheet buttons and segmented controls are solid, so no glass sits on glass. |
| 7 | Fixed | Ctrl+, (Cmd+, on Mac) opens and closes Settings. |
| 8 | Fixed | Menu items in title-style capitals ("Find Lyrics Online…", "Edit Lyric Timing…", "Use Still Cover", "Full Screen", "What's New"); the docs use the same names. |

## Delivery Gate

### Block 1: Hard Gate
- R-02 PASS: no em or en dash left in any message people see (remaining ones are code comments and the parser that splits "Artist — Album").
- R-25 PASS, measured: `--label-2` over the worst panel bases, computed from the panel layers (76% tint, white gloss) over the brightest covers: saturated yellow art 4.74:1, pure white 4.39:1 at mid gloss; only the top-left highlight corner of a panel over a pure white cover dips to 4.0:1, where only the panel's bold title sits (needs 3:1). On the player background over the olive of a yellow cover: 4.59:1. Checked by eye on renders over アイドル (yellow cover): library, equalizer, menu, settings, search.
- R-32 PASS: focus rings listed in 2; Ctrl+, added.
- R-34 PASS: the one theme plus the two system modes, both exercised (below).
- R-35 PASS, click-through in the browser and offscreen Chromium: Ctrl+, opens Settings and closes it again; menu shows the new labels; secondary text computes to rgba(255,255,255,0.8); no glass class on toggles, stepper, sheet buttons or segmented controls (0 of them); emulated Reduce Transparency turns menu blur to `none`; emulated Increase Contrast sets `--label-2` to #fff and `--dim` to 55%; 94/94 tests pass; no console errors in the app.

### Block 2: Purpose-Gate
- R-10 PASS: glass on the floating layer only, no glass on glass.
- R-12 / R-13: unchanged shadows mark the floating layer (menus, sheets) only.

### Block 4: Craftsmanship
- R-11 / R-29 / R-31: unchanged palette (white on cover tint, Apple Music identity); reasons for the new tokens written next to them in `styles.css`.
