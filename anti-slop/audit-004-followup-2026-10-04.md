# Audit 004 follow-up: player revamp, closer to Apple Music

Date: 2026-10-04
Approved by the owner: all findings (1-8)
Released as 2.13.0 (web update; no new installer needed)

## Findings

| # | Status | What changed |
|---|---|---|
| 1 | Fixed | The ••• menu: 3 labelled tiles (Card, Clip, Full Screen), Apple's medium layout, then 4 short groups (Lyrics, Listening, More, App). Two submenus open in place with a turning chevron: "Lyrics Tools" (Edit Lyric Timing, Tap to Sync, Send to AMLL, Lyric Offset) and "Open" (Load New Song, Load Lyrics File, Find Album Cover, Use Still Cover). Floating moved from the tiles to the App group as "Floating Lyrics". The menu no longer scrolls: it opens towards the side with more room and slides over its button when it doesn't fit (`player-ui.js › placeMenu`). Every item still works; none removed. |
| 2 | Fixed | One glass platter: rows have no fill, a rounded highlight on hover, a thin line between groups (`apple-ui.css`, menu block). Library song lists sit on the panel with no box, a hairline starting after the cover, regular-weight titles. Settings keeps Apple's grouped style (one fill per group, which is how Apple draws settings), with dividers that start at the text instead of full width. |
| 3 | Fixed (different cause) | Real cause, found by testing in Chromium: inside the player, the menu's backdrop blur skipped the controls painted after it (play button, progress bar, star and ••• buttons stayed sharp under the menu). Moving the menu to the top of the page fixes it (`player-ui.js`, constructor). The library and settings "smears" in the audit were not in the app: offscreen captures don't render backdrop blur at all; in a real window those panels blur correctly. Large panels also blur more (22 to 44 px). |
| 4 | Fixed | Bottom row: Lyrics, AirPlay / Cast, Library. Settings is in ••• and on Ctrl+, / S; Full Screen in the ••• tiles and on F / F11. Docs updated. |
| 5 | Fixed, one change from the audit | Sliders sit on the row with their name and value (macOS settings style): rows went from about 86 px to 44 px; 13 settings fit where 6 did. Group titles are bold title case, not small capitals. Change: the explanations stay under their own setting instead of moving to the group footer, so each hint stays next to the setting it explains (macOS System Settings does the same). |
| 6 | Fixed | The song playing shows Apple Music's three bars in pink over its cover, moving while playing and still while paused (`html.is-playing`), still under Reduce Motion. The "♪" text mark is gone; the row has `aria-current`. |
| 7 | Fixed | Menu icons redrawn on one 24 px grid at one stroke (1.6), outline only (the filled pieces in Equalizer, Mini Player and Lyrics Quiz are now outlines). New: Lyrics Tools, Open (folder), Tap to Sync (taps), chevron. |
| 8 | Fixed | The menu grows out of the ••• button with a spring (its transform origin is set to the button's centre); submenus fade down; Settings and the Library slide in as before, now with a 22% dim over the player. Reduce Motion: plain fade. |

## Delivery Gate

### Block 1: Hard Gate
- R-02 PASS: new copy (menu labels, changelog, docs, hints) has no em or en dashes.
- R-25 PASS: text colours unchanged from 2.12.0 (`--label-2` on the same 76% panel tint); row text is white on that tint. Panel blur raised, which only lowers contrast risk.
- R-32 PASS: submenu rows are buttons with `aria-expanded` and `aria-controls`; the focus ring from 2.12.0 applies; Ctrl+, unchanged.
- R-35 PASS, click-through in a real Chromium window (browser pane) and Electron:
  - ••• menu opens fully on screen with no scrolling at 1280x800, lands over the button when the window is short.
  - Lyrics Tools and Open open in place and the menu stays on screen; the offset stepper keeps the menu open.
  - In Apple Music Mode the menu opens downward from the button.
  - Behind the menu the cover and controls are blurred (verified by toggling the menu between its old and new place in the page).
  - Settings rows measure 44 px; Library shows the bars on the playing song.
  - 94/94 tests pass; no console errors.

### Block 2: Purpose-Gate
- R-10 PASS: glass on the menu platter, sheets and player buttons only; no glass on rows.

### Block 4: Craftsmanship
- Docs: all 12 screenshots and 3 clips re-captured from the owner's library, now from GPU-composited windows so the glass renders as it does in the app; website hero clips and the find-lyrics image re-captured too.
