# Spike: one Veo 3.1 Lite clip on Vertex

**Questions (plan section 11, week 1):** does Veo 3.1 Lite generate on our project through Vertex, what comes back, and what is the billing unit (open item 17.1: per second, about INR 35 for 8s at 1080p, or per video, about 8 times less)?

**Answer so far:** it generates, and the output is usable. **The billing unit is still open:** the billing line has not appeared yet (see "Read the billing line" below). Run on 2026-09-18 with `spikes/veo-clip.ts`, 1080p only, as agreed.

## What was run

- Model `veo-3.1-lite-generate-001`, project `creatorpltfrm`, region `us-central1`, through `predictLongRunning`, then polling `fetchPredictOperation` every 10s.
- Parameters: `aspectRatio` 9:16, `durationSeconds` 8, `resolution` 1080p, `sampleCount` 1, and a negative prompt against text, captions, letters, watermarks and logos. `generateAudio` was not set.
- Prompt: a slow push-in on a steaming glass of masala chai by a sunlit window. Scene only, no text (invariant 12).

## Results

| Check           | Result                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- |
| Generation time | 124.7s from submit to done                                                               |
| File            | 8.00s, 11.7 MB, returned inline as base64 (no Cloud Storage bucket needed)               |
| Video           | H.264 High, yuv420p, 1080x1920, **24 fps**, about 12 Mbps                                |
| Audio           | **An AAC stereo track with real sound**: mean -18 dB, peak -2 dB                         |
| Quality         | Photoreal; the steam moves naturally and the push-in is visible from first frame to last |
| Text in frame   | None. The negative prompt held                                                           |
| Safety filter   | Nothing filtered                                                                         |

## What this means for the build

- **Veo generates audio unless told not to.** The plan's video rate (USD 0.05 per unit at 1080p) is the video only price. This clip was probably billed at the audio rate. The adapter must send `generateAudio: false` (the spike script now does). Voiceover and music are added in the render, so Veo's soundtrack would be thrown away anyway. Confirm on the next generation that the parameter is accepted and the clip comes back silent.
- **Clips are 24 fps, not 30.** The caption spike rendered at 30. Rendering the final reel at 24 keeps motion clean; converting to 30 duplicates frames and judders. Decide in WP24; Reels accepts 24.
- **Generation takes about two minutes per clip.** Three scenes run in parallel, so roughly two minutes for a whole reel. That confirms the runbook rule: never render live in the demo; commit at step 4 and come back at step 5.
- **No storage bucket is needed for generation.** Clips come back inline, and the worker writes them to R2 itself.

## Read the billing line (still to do)

Billing data can take up to about a day to appear. Then:

1. Open **Billing → Reports** in the console, filtered to project `creatorpltfrm` and grouped by **SKU**.
2. Find the Veo line for 2026-09-18 and note three things: the **SKU name** (does it say audio?), the **usage amount and unit** (8 seconds, or 1 video?), and the **cost** before credits.
3. Record them here. **8 seconds at about USD 0.40 means per second billing, and the plan's video figures stand. About USD 0.05 for the whole clip means per video billing, and every video figure falls by about 8 times.** A higher rate on an audio SKU confirms the `generateAudio` point above.

## Not yet verified

- The billing unit and rate, pending the billing line.
- That `generateAudio: false` is accepted, and that it lowers the price.
- 720p, skipped by choice to save credit. The plan's lower cost variant (INR 16,400) depends on it.
- Veo quota for parallel scenes: three clips at once, as the three scene reel needs.
