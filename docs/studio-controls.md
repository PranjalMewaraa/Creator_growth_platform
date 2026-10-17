# Studio: every control, by generator (WP53/54)

Built by reading `apps/web/src/app/w/[workspaceId]/studio/studio.tsx` and
`output-view.tsx` directly — not inferred from the UI. "Control" means something you can
click, type into, or choose; readouts (cost, balance, the script meter, token counts) are
left out unless they're attached to a control.

## On every kind, no matter which

| Control | What it does |
|---|---|
| **Generator** | The six cards (Script, Hooks & titles, Captions, Image, Thumbnail, Video) — picks the kind, resets the template choice |
| **Template** | One card per template matching the kind's output type, or the plain default with no angle of its own |
| **What do you want?** | The intent — free text, required, the one thing every generator is built from |
| **For** | Platform target: Instagram / LinkedIn / Anywhere |
| **Tone for this one** | Optional free text, overrides the profile's tone for this generation only |
| **See the prompt / Rewrite prompt** | Compiles and opens the engine's compiled prompt (`PromptDisclosure`), itself editable before anything is spent |
| **Generate** | Submits. Label changes on Video (below) |
| **Copy** (on text output) | Copies a script, hook, title or caption to the clipboard; records that this generation was actually used |

## Script only

| Control | What it does |
|---|---|
| **Length** | Default / 15s / 30s / 45s / 60s / 90s — sets the target the script is written to |

## Hooks & titles only

No control beyond the shared set. Output is a Hooks list and a Titles list, each item
with its own character count and Copy button.

## Captions only

| Control | What it does |
|---|---|
| **Captions for** | Multi-select: Instagram / LinkedIn. None picked falls back to the single "For" platform |

Output is one caption card per platform, each independently editable, with **Reset**
(appears once you've changed it) and **Copy**, plus a live length/hashtag meter.

## Image only

| Control | What it does |
|---|---|
| **How many** | 1 / 2 / 3 / 4 — each variant is priced and billed separately |
| **Look** | Camera / Lens / Focal length / Aperture, each a row of chips from the pinned vocabulary (WP37); picking the chosen one again clears it |

Output per image: **Add text / Edit the text** (opens the text-layer editor, its own
font/colour/position controls), **Open** (the file, new tab), **Use in a post** (hands the
image straight to the Composer with its frame already set — WP33).

## Thumbnail only

Same **Look** row as Image. Count is fixed at three variants, not user-set. Output
controls are the same three as Image (Add/Edit text, Open, Use in a post), one set per
thumbnail.

## Video only

| Control | What it does |
|---|---|
| **Look** | Same four rows as Image |
| **Scenes** | 1 / 2 / 3 — each scene is eight seconds, so this sets both the length and the price |
| **Storyboard first** | A second submit button: draws stills before committing to film, so a wrong reel is caught at the cost of a few pictures rather than the full render |
| **Film it / Film this storyboard** | The main submit; the label changes once a storyboard has been approved |

Storyboard output: per-frame **Redraw**, with an optional note on what's wrong with that
one frame (WP50) — the other frames are untouched and the redraw costs one picture, not
the set. Then **Film these scenes / Film this storyboard**, which commits to the render.

Finished reel output: per-scene **Film again** (WP50/22) — regenerates one eight-second
scene in place, paid in video seconds, without re-filming the other two.
