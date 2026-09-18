# Spike: burned in captions at 9:16 with a pinned font stack

**Question (plan section 11, week 1):** can ffmpeg composite clean captions over a 1080x1920 reel, with a fixed font stack that covers Devanagari, before the render pipeline is designed around it? The risk the plan names is "discovering in week 6 that ffmpeg cannot composite captions cleanly over generated video".

**Answer: yes.** Run on 2026-09-18 with `spikes/ffmpeg-captions.ts`. ASS subtitles rendered by libass through ffmpeg's `subtitles` filter, over ffmpeg's busy `testsrc2` pattern as a hard legibility case.

## Setup

- **ffmpeg 6.1.1**, gyan.dev essentials build for Windows (via the ffmpeg-static release, not committed). It includes libass 0.17, FreeType, HarfBuzz 8.3, FriBidi and fontconfig. The render box (WP6) needs an ffmpeg with the same libraries; Debian and Ubuntu's packaged ffmpeg has them.
- **Pinned fonts** in `infra/render-box/fonts`, all SIL Open Font Licence, loaded with `fontsdir` so no system font is involved:
  - Poppins SemiBold and Bold, which cover Latin and Devanagari and match the UI.
  - Noto Sans Devanagari (variable), kept as the Devanagari fallback.
- **Captions come from timed script lines,** standing in for text to speech timepoints (invariant 13). `PlayResX/Y` equal the frame size, so every margin is in real pixels.

## Results

| Check                      | Result                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Font actually used         | libass log: `Poppins SemiBold -> Poppins-SemiBold`, the pinned file                                                                                                                |
| Complex script shaping     | HarfBuzz active in COMPLEX mode; no missing glyph warnings                                                                                                                         |
| Hindi line                 | Correct: matras placed properly, including the pre-base `ि`. Poppins shows the `ब्द` in `शब्दों` with an explicit halant rather than a half form: correct, less polished than Noto |
| Hinglish line              | Latin and Devanagari mix in one font with a consistent baseline                                                                                                                    |
| ₹ and digits               | Render in Poppins                                                                                                                                                                  |
| Long line                  | Wraps into two balanced, centred lines inside the side margins                                                                                                                     |
| Word by word highlight     | ASS `\k` timing works: words switch from white to the accent colour on time                                                                                                        |
| Legibility over busy video | A 5px black outline keeps white text readable on every colour bar                                                                                                                  |
| Output                     | H.264 High, yuv420p, 1080x1920 (9:16), 30 fps, AAC 48 kHz stereo, 24.0s, about 8.5 Mbps, `+faststart`                                                                              |
| Speed                      | 24s reel rendered in 11.4s on a laptop, about twice real time, `-preset medium -crf 20`                                                                                            |

## What this means for the build

- **The compositing risk is retired.** WP24 and WP25 can rely on ASS plus libass for captions, including Hindi, when that path is switched on.
- **Fonts are pinned per render, not per machine.** Copy `infra/render-box/fonts` into the render box image and always pass `fontsdir`.
- **Poppins alone covers the demo's scripts.** Keep Noto Sans Devanagari for glyphs Poppins lacks; libass falls back through the fonts directory.
- **Render speed is not the bottleneck.** About 12s of compositing for a 24s reel. Provider generation time will dominate.

## Tuning left for WP25

- **Word spacing looks tight.** The 5px outline eats into the gaps between words ("Plans from ₹999 a month" nearly runs together). Try a 3 to 4px outline, a small positive `Spacing`, or a soft shadow or translucent box instead.
- **64px text is on the small side for reels.** 72 to 80px is closer to common practice at 1080 wide.
- **Safe area needs a device check.** `MarginV` 480 puts captions about 73 percent of the way down the frame. That should clear Instagram's caption and button overlay, but check against a real Reel on a phone in week 7.
- **Emoji are untested.** libass does not render colour emoji; strip or replace them in captions.
