# Audit 001 follow-up: showcase video remake

Date: 2026-10-03
Approved by the owner: all findings (1-16)
Output: `private-videos/Lyric Player - showcase v2 (private).mp4` (45.00 s, 1920x1080, 60 fps, AAC 256 kb/s)
Source: `show2.html` (layout and reasons in its header comment), `prep2.py` (beat-snapped cuts, washes, soundtrack)

Design read: product showcase video of Lyric Player for the owner and the people they show it to privately, in a bold and kinetic language. Dial ENERGY 3 / RHYTHM 3 / MOTION 3 (owner's choice).

## Findings

| # | Status | What changed |
|---|---|---|
| 1 | Fixed | Intro now reads "Lyric Player, for Windows, Mac and iPhone." No "every feature" claim. |
| 2 | Fixed | Built to the owner's direction (bold and kinetic, dials 3/3/3). |
| 3 | Fixed | Orbs removed. Near-black base, one wash per scene from that song's cover colour (measured from the footage); the AutoMix scene's wash moves from Good Person's colour to Brain Rot's across the blend. |
| 4 | Fixed | No glass anywhere. |
| 5 | Fixed | No drop shadows; a 1 px hairline separates footage from the background. |
| 6 | Fixed | No emoji in the video's own text (the emoji in scene 1 are the app's real Emoji reactions feature). |
| 7 | Fixed | The pill grid is gone; see 14. |
| 8 | Fixed | No template entrances or sound effects. Hard cuts land on a beat of the incoming song (beat grids from the app's own AutoMix analysis); kinetic words land one per beat; the camera only moves to follow the app (menu to settings sheet) or as one slow push per scene. The soundtrack is the music alone. |
| 9 | Fixed | Archivo (wide, black) for the kinetic words: broad, heavy letters fill a 16:9 frame with few words. SF Pro Display, the app's own face, for the small lines. Inter is not used. |
| 10 | Fixed | No eyebrow kickers. |
| 11 | Fixed | No scene counter. |
| 12 | Fixed | The app's pink appears once: Brain Rot's tempo turns pink when AutoMix locks the beats. |
| 13 | Fixed | Nine different compositions: footage on the right half; words behind a phone; a narrow word column; the preset name as the headline; a camera that follows a menu; type that changes font and colour with the app; tempo readout over footage; a close crop on the quiz; phone left, words right. |
| 14 | Fixed | The closing list is six real features, one per beat, then the end card. |
| 15 | Fixed | Nothing is pill-shaped. Windows 16 px, phones 54 px. |
| 16 | Fixed | Palette: off-black, off-white, one cover wash at a time, one pink moment. The fonts-and-colours scene shows the app's own lyric colours, because that scene is about them. |

Where the skills disagreed, the stricter rule won: high-end-visual-design asks for eyebrow pills, double-bezel cards and pill buttons, which antislop R-09 / R-11 / R-14 reject without a purpose. None were used.

## Delivery Gate

### Block 1: Hard Gate (all must be no)
- R-02 PASS: no em or en dash in any visible text (`show2.html` has none at all).
- R-03 N/A: a 1920x1080 video, not a responsive page. Every frame checked at its only size: no text runs off the frame or into footage (sample frames at 2.0, 5.3, 9.3, 13.3, 16.8, 20.7, 24.2, 28.7, 34.3, 37.5, 41.3, 44.0 s).
- R-17 PASS: every number is real: 134 and 135 BPM (measured), 0.7% (rate 0.9927), 10 bands, 0 ms offset shown by the app.
- R-18 PASS: no testimonials.
- R-23 PASS: app icon and Ruytha's avatar supplied by the owner.
- R-24 / R-26 / R-27 / R-32 N/A: a video has no navigation or controls.
- R-25 PASS: measured on rendered frames, brightest 10% of the background next to each text: small lines 8.49:1, song credit 6.91:1, unlit part of a kinetic word mid-sweep 3.97:1 (large text, needs 3:1; first render failed at 2.15:1 and was fixed before delivery).
- R-28 N/A: no FAQ.
- R-33 PASS for the deliverable: the video is built from source files. (Edits to `show2.html` during this work were scripted string replacements on the scratch file; the shipped page source is the file itself.)
- R-34 N/A: no theme toggle.
- R-35 PASS: rendered and watched as frames: full 2,700-frame render, encoded, 12 frames pulled back out of the final MP4 and checked; no render errors.
- R-36 PASS: no claims beyond what the footage shows.
- R-37 PASS: owner direction recorded above.
- R-38 PASS: every feature named exists in the app.

### Block 2: Purpose-Gate
- R-01 PASS: one cover wash per scene, reason written (the player tints from the cover). No default gradients.
- R-04 PASS: no icons in the video's own layer.
- R-06 PASS: typefaces chosen with written reasons; no monospace, no wide-tracked uppercase.
- R-07 PASS: grain is a fixed 5% layer with a stated purpose (stops banding in the encode); no grid patterns.
- R-08 / R-09 PASS: no arrows, no badges.
- R-10 / R-12 / R-13 PASS: no glass, no shadows, no glow.
- R-14 PASS: no cards.
- R-19 PASS: every motion has a stated purpose (beat, follow the action, one push); MOTION 3 is visible.
- R-22 PASS: no illustrations.

### Block 3: Liveliness
- Dials set and followed: yes (3/3/3; every scene differs, cuts and words move with the music).
- One focal point per screen: yes (the kinetic words, or the footage when the words are done).
- Whitespace as structure: yes (the dark field separates words from footage).
- One deliberate accent: yes (the tempo lock).
- Identity motif: yes (words light like sung lyrics in the app).
- Design read declared before generation: yes.

### Block 4: Craftsmanship and Quality Locks
- C-1 to C-5 PASS: every decision has a written reason; nothing fabricated; every scene shows a real feature.
- R-05 PASS: no template composition; nine distinct layouts.
- R-11 PASS: radius scale 16 px (windows) and 54 px (phones), nothing pill-shaped.
- R-15 N/A: no CTA.
- R-16 PASS: no buzzwords.
- R-20 PASS: swap the name and the video still belongs to this app (its footage, its lyric sweep, its songs).
- R-21 PASS: dark base is the owner's direction and matches the player's own dark lyric screen.
- R-29 PASS: off-black, off-white, one wash, one accent.
- R-30 PASS: not modelled on another product's video.
- R-31 PASS: reasons written in `show2.html`.
