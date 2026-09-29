# Demo runbook

Written 2026-09-28, against what is built rather than what was planned. Where the two differ,
this document follows the build and says so. Plan section 15 is the source for the sequence;
the corrections below are what eight weeks actually produced.

Ten to twelve minutes. Read it once, then rehearse it three times (plan section 11: the third
run with someone outside the team driving).

---

## Before the room

Half an hour before, not five minutes before.

| Check                        | How                                                           | If it fails                                                                                    |
| ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Worker running               | `pnpm --filter @cgp/worker start`, wait for `worker started`  | Nothing generates. Everything else is scenery                                                  |
| Web running                  | `pnpm --filter @cgp/web start`, wait for `Ready in`           | —                                                                                              |
| Redis and Postgres reachable | The worker's boot sweep logs `boot sweep done`                | Jobs queue and never run                                                                       |
| Google reachable             | Open Studio, generate one caption                             | Vertex, Vision and GCS all live behind the same link. This machine has lost it twice in a week |
| ffmpeg present               | `tools/ffmpeg/ffmpeg.exe -version`                            | Video renders fail at the last step, after paying for the clip                                 |
| Balances                     | Home shows credits and video seconds                          | A reel needs 8 seconds per scene. Check before, not during                                     |
| Accounts connected           | Accounts screen, both green, neither inside 14 days of expiry | Publishing fails at the claim                                                                  |
| `PUBLISHING`                 | `fake` unless you intend real posts in the room               | A real post is public and permanent                                                            |

Decide before you start whether step 6 posts for real. Both answers are defensible; being
unsure at the moment of clicking is not.

---

## The sequence

### 1 — Open on a populated workspace (30s)

Home, with the week filled. The seven day strip, the balances, account health.

**Says:** this is a product, not one path through a prototype.

Do not narrate the screen. Let them read it while you say what the company is.

### 2 — Type plain intent, open the compiled prompt (2 min)

Studio. Type something underspecified in ordinary words — _"something about the cold brew"_ —
and submit. Then open the compiled prompt disclosure and read part of it aloud.

**Says:** the orchestration engine, which is the product.

**Slow down here.** This is the moment the demo is for. The disclosure shows the profile, the
brand kit and the platform constraints assembled into a prompt nobody typed. Read the shot
specification lines — they are the ones that sound like a director rather than a chatbot.

### 3 — Caption set and a thumbnail, with cost shown first (2 min)

Generate captions across both platforms, and a thumbnail. Point at the cost line **before**
submitting.

**Says:** per-platform adaptation, and that the team meters its own spending.

### 4 — Storyboard, then commit the render (1.5 min)

Ask for a reel. Take the storyboard first: one still per scene from the image model, about a
rupee each, against twenty-one for a filmed clip. Approve it, commit, **leave it running**.

**Says:** cost control ahead of the expensive action. This is the most commercially literate
moment in the demo.

### 5 — Show a finished reel, pre-rendered (1 min)

Never render live. Open one filmed earlier — the template gallery has four, each a real
render with voice and burned-in captions.

**Says:** the render pipeline is real.

### 6 — Schedule to both accounts, watch the Sync centre (2 min)

Composer. Take a generated image straight in with **Use in a post** — no download, no
re-upload. Choose both accounts, set a time a minute or two out, schedule it. Open the Sync
centre and watch the target go from waiting to published.

**Says:** fan-out with independent per-target status.

**Correction to the plan:** section 9 expected a generated _reel_ published to a real account.
Video publishing is not built — the Instagram and LinkedIn adapters post images. Schedule an
**image** post. If asked about video: the render pipeline is finished, the publishing side of
it is not, and it is a known two-to-three week item.

### 7 — Insights on an older post (1.5 min)

Open Insights. Real numbers from the platforms on posts published a week or two earlier.

**Says:** the loop closes.

**This step needs preparation nobody can do on the day.** At least three posts must have gone
out 1–2 weeks before, with `PUBLISHING=real`. Without that this screen is a row of dashes and
the step should be cut rather than explained away.

### 8 — The lift number (1 min)

State it as a sentence, not a screen:

> On twenty blind comparisons against the same model given the raw intent, the compiled prompt
> was preferred every time — and it was usually the shorter output.

**Says:** step 2 was a measurement, not a claim.

This is the strongest moment in the demo and the last thing to cut. If someone asks who
judged: one judge, the person who built it, twenty intents in one domain. Say that plainly. An
honest strong signal beats an oversold measurement, and they will ask.

---

## What the demo must not claim

Straight from plan section 15, and all three still true:

- **Approvals are not held.** Publishing is developer mode against team-controlled accounts.
- **Nothing has been tested at scale.** The reliability engineering is deliberately not built.
- **Analytics are thin and real, never thin and simulated.** Never fabricate a number in
  Insights. The screen shows a dash where a platform reported nothing, and that dash is the
  product working correctly.

Three more this build has earned:

- **Video cannot be published from the product.** Rendered, yes. Posted, no.
- **The eval is one judge.** Strong internal signal, stated as one.
- **The OAuth connect flow has never completed a round trip.** It is built and tested to the
  consent screen; both tokens in the demo workspace were imported by hand.

---

## If it goes wrong

| Failure                              | What to do                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Render too slow to watch             | Never render live. Commit at step 4, return to it at step 5                                                                    |
| Provider slow or down                | The rewrite pass falls back deterministically and the compile still happens. A hard outage means the recording                 |
| Network in the room                  | Recorded fallback, on the machine, not streamed                                                                                |
| Platform rejects the publish         | Open the Sync centre and read the platform's own words off the screen. Rehearse this once — it is a good moment, not a bad one |
| A scheduled post does not fire       | The dispatcher ticks every fifteen seconds against a sixty second promise. Give it a minute before touching anything           |
| Poor output on an unrehearsed prompt | Offer to work within a template. Never raw mode                                                                                |

Do not take arbitrary prompts from the room. The evaluation set says the templates hold up; it
says nothing about whatever someone shouts out.

---

## Seed data still to prepare

Plan section 15 wants 2–5 workspaces. Demo Studio is populated; the rest is outstanding:

- [ ] Three real posts published 1–2 weeks ahead, so step 7 exists at all — **the only one of
      these that cannot be scripted, and the only one with a deadline**
- [ ] A library of prior outputs, so Studio opens populated. Generating these means real
      provider calls: a few runs through Studio with PROVIDERS=real is the honest way
- [x] 4–6 weeks of calendar history — `pnpm --filter @cgp/worker seed:history <workspace id>`
      (24 posts over six weeks are in Demo Studio; `--clear` removes them, and they never
      appear in Insights because no platform was ever asked about them)
- [x] One workspace deliberately near-empty — New Creator, seeded from the start
- [x] Credit balances at plausible plan levels — granted by the seed, 2000 credits and 120 video seconds
