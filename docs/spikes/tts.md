# Spike: text to speech timing and voice tier

**Questions (plan sections 11 and 17.3):** which Google Cloud TTS voices return timepoints we can drive captions from, and what does a voiceover cost? The cost figure was the only one in the plan not taken from a published price list (about INR 0.75 per 30s).

**Answer:** Standard, WaveNet and Neural2 voices return timepoints at SSML marks; Chirp 3 HD does not. Every tier costs well under INR 1.25 per 30s voiceover and is free inside the monthly allowance. Run on 2026-09-18 with `spikes/tts-timepoints.ts`, Indian English (`en-IN`).

## Prices (Google's pricing page, 2026-09-18)

| Voice type           | Free per month | Then, per 1M characters                    | 30s voiceover, about 450 characters |
| -------------------- | -------------- | ------------------------------------------ | ----------------------------------- |
| Standard             | 4M characters  | USD 4                                      | about INR 0.16                      |
| WaveNet              | 4M characters  | USD 4                                      | about INR 0.16                      |
| Neural2              | 1M characters  | USD 16                                     | about INR 0.63                      |
| Chirp 3: HD          | 1M characters  | USD 30                                     | about INR 1.19                      |
| Studio               | 1M characters  | USD 160                                    | about INR 6.34                      |
| Gemini 2.5 Flash TTS | none           | USD 10 per 1M audio tokens (25 per second) | about INR 0.66                      |

Characters are counted on the whole input string, so SSML tags are probably billed too. The test SSML was 270 characters for 134 characters of speech. At these prices that doesn't matter.

## What was run

The script was split into six caption segments with an SSML `<mark>` before each and one at the end, sent to `v1beta1/text:synthesize` with `enableTimePointing: ["SSML_MARK"]`, one voice per type.

| Voice                      | Result                            |
| -------------------------- | --------------------------------- |
| `en-IN-Standard-A`         | 7 of 7 timepoints, 1.2s           |
| `en-IN-Wavenet-A`          | 7 of 7 timepoints, 1.3s           |
| `en-IN-Neural2-A`          | 7 of 7 timepoints, 0.7s           |
| `en-IN-Chirp3-HD-Achernar` | Audio returned, **0 timepoints**  |
| `en-IN-Chirp-HD-F`         | HTTP 400: rejects this SSML input |
| Studio                     | No `en-IN` Studio voices exist    |

The three voices with timepoints gave identical segment timings, for example "Plan it." from 2.62s to 3.40s, and identical 9.38s durations, but different audio. They appear to share one timing model for `en-IN` and differ in how the voice is produced. The available voices were 30 Chirp 3 HD, 6 Standard, 6 WaveNet, 4 Neural2 and 3 Chirp HD.

## What this means for the build

- **Captions can come from the voice's own timing** (invariant 13), with Standard, WaveNet or Neural2: one mark per caption segment gives each segment a start and an end.
- **Chirp 3 HD sounds the most natural but cannot time captions from marks.** If it is wanted for quality, there is a workaround that keeps invariant 13: synthesise each caption segment separately, use each clip's length as its timing, and join them. That costs the same characters. Pauses between segments are ours to set, and phrasing across segment boundaries may sound slightly less connected.
- **Cost is not a factor.** The demo stays inside the free allowance on any tier. Open item 17.3 is settled: the plan's INR 0.75 estimate was in the right range.

## Decision for 17.3

**Neural2, `en-IN-Neural2-A`**, chosen 2026-09-18 after listening to the four samples. It has native timepoints, was the fastest here, and costs about INR 0.63 per 30s after the free 1M characters. Chirp 3 HD with the per segment workaround stays available if a later listening test wants a more natural voice.

## Not yet verified

- Word level timing, for the word by word highlight. Marks were per segment here. A mark before every word works the same way but was not run.
- Hindi voices (`hi-IN`), out of scope for the demo (English only).
- Whether SSML tags are billed, which only matters at scale.
