# Demo Build: Implementation Plan

**Companion to `plan.md`.** `plan.md` says what and why. This file says how, in what order, and what has been decided. Where the two disagree, `plan.md` wins.

**Status:** 2026-09-26. WP23 is built, so a reel speaks. Compiler profiles are at v6: scenes and images are written as full shot specifications, with labelled lines for framing, subject, action, camera, setting, light, palette and texture, continuity carried across the scenes of one reel, and a spoken line per scene. A one line summary was producing stock looking output; the detail is the product. WP1 to WP5, WP7 to WP24 built: weeks 1 to 4, plus the video adapter, the scene model and the render worker. WP23 (voiceover) and WP25 (captions) are the gaps in the video pipeline. The week 4 checkpoint is the one thing outstanding: the evaluation set has run, and the lift against the raw control needs a person to judge it. Amendments A1 to A11 accepted and applied to `plan.md`. Items marked OPEN need an answer before the work package that depends on them.

---

## 1. Technical decisions

| # | Decision | Recommendation | Status | Blocks |
|---|---|---|---|---|
| D1 | Hosting topology (open item 17.2) | As written in plan section 5: Vercel for web, R2 for storage, one GCE VM for worker + ffmpeg Storage changed 2026-09-18: R2 needs a payment method even on its free tier, so media lives in GCS for now (bucket `creatorpltfrm-media`, us-central1, uniform access, objects publicly readable by unguessable key, since Instagram fetches media by URL). Behind the `ObjectStore` interface, so R2 or signed URLs later is a change in one adapter | DECIDED 2026-09-14, storage amended 2026-09-18 | |
| D1b | Postgres and Redis providers | Postgres: Neon, Singapore (`ap-southeast-1`), Postgres 18, in use for development. Pin Vercel functions and the render VM to Singapore too. Check the Neon plan before the demo: free tier compute suspends when idle, and the first query after that is slow. Redis still open: smallest managed instance in the same region, not billed per command, since BullMQ polls constantly | Postgres DECIDED 2026-09-16, Redis OPEN | WP6 |
| D2 | Publishing pair (open item 17.7) | Instagram + LinkedIn | DECIDED 2026-09-14 | |
| D3 | Moderation endpoint (not named in plan) | Cloud Natural Language `moderateText` + Vision SafeSearch. Both GCP, credit eligible. Verify free tier on the day. Adapter built in WP11 (`MODERATION=google`). Both APIs enabled and checked live 2026-09-18: ordinary text allowed, a violent sentence blocked (violence 1.00), a politics and finance topic allowed. A check adds about 0.5 to 2s to dispatch. The same violent sentence also scored Illicit Drugs 0.88, so the 0.8 threshold may need tuning against the week 4 eval set | DECIDED 2026-09-18 | WP11 |
| D4 | Monorepo | pnpm workspaces + Turborepo, Node 24 LTS, TypeScript 6.0 strict, ESLint 9. TypeScript 7 and ESLint 10 wait until typescript-eslint and eslint-config-next support them | DECIDED in WP1 | |
| D5 | ORM and migrations | Drizzle + drizzle-kit. SQL shaped, supports `FOR UPDATE`, typed | proposed | |
| D6 | Auth | better-auth, email magic link, database sessions. Chosen over Auth.js v5, still beta (`5.0.0-beta.32`), because better-auth is a stable release and its magic link option refuses unknown emails, which is exactly A11. Without an email sender the link goes to the server log; a real sender is needed before anyone outside the team signs in | DECIDED in WP4 | |
| D7 | UI | Tailwind 4 with design tokens in CSS, primitives in `packages/ui`. shadcn/ui is deferred until a screen needs dialogs, menus or complex form controls | DECIDED in WP4 | |
| D8 | Queue | BullMQ, one queue per job class (`inference`, `render`, `publish`) in one worker process | proposed | |
| D9 | Streamed output | Worker publishes tokens to Redis pub/sub, web exposes an SSE route, client falls back to polling job status | DECIDED in WP9. The stream closes after a terminal status or about 55s, and the client closes EventSource on a terminal status, since EventSource otherwise reconnects | |
| D10 | Provider SDKs | `@google/genai` in Vertex mode (Gemini, Imagen, Veo), `@anthropic-ai/vertex-sdk` (Haiku), `@google-cloud/text-to-speech`. Checked 2026-09-18 on project `creatorpltfrm`: Gemini 3.x answers only on the `global` endpoint (`us-central1` returns 404), while Veo and Imagen are regional, so location is per model in adapter config, not one project wide value. Model ids seen: `gemini-3.1-flash-lite`, `veo-3.1-lite-generate-001`. Newer versions exist (`gemini-3.5-flash-lite` and later Flash releases); the costing is based on 3.1, so any switch needs a pricing check first (plan section 17) | proposed | |
| D11 | Token encryption | AES-256-GCM per token, data key wrapped by a key held in Vercel and worker env, never in the database | DECIDED 2026-09-18: built in `packages/config` (`encryptSecret`), key in `TOKEN_ENCRYPTION_KEY` | |
| D12 | Image text layer | SVG layer spec stored as JSON, edited in browser, flattened in worker with resvg using the same font files | DECIDED 2026-09-24, built in WP18, with one departure: the flattening happens in the web request, not the worker. It takes about 300ms, costs no credit and has no provider call, and uploads already run sharp in the same place, so a job with a hold and a queue would be ceremony around a synchronous operation. Video captions are the case that would move it to the worker. The rest is as proposed: the spec is JSON on the rendition row, the browser previews it, and resvg rasterises it with four pinned font files (Poppins and Noto Sans Devanagari, regular and bold, OFL, vendored in `packages/core/fonts`), with system fonts off so a font installed on a machine can never change the output. Two bundler notes worth keeping: the font directory is resolved through `require.resolve('@cgp/core/package.json')`, because a bundler rewrites `new URL('../fonts/', import.meta.url)` at build time and then fails to resolve a directory, and `@resvg/resvg-js` is a platform binary, so it is in `serverExternalPackages` and a direct dependency of the web app | |
| D13 | Tests | Vitest. Database tests run on PGlite (in-memory Postgres, same constraints and triggers, no docker). Concurrency tests, such as two writers racing for a hold, need the docker Postgres from WP7 on | DECIDED in WP3 | |
| D14 | Exchange rate (open item 17.5) | 88, stored once in config, every rupee figure derived from it | proposed | |
| D15 | Facebook Page publishing | Not for this demo. It would have cost about half a week, and the API posts only to Pages, never personal profiles, so it helps fewer individual creators than Instagram and LinkedIn do. Post-demo item: same Meta app, adding Facebook Login for Business (`pages_show_list`, `pages_manage_posts`, `pages_read_engagement`) | DECIDED 2026-09-18: dropped | |
| D16 | Claude Haiku access on Vertex | Checked 2026-09-18: `claude-haiku-4-5@20251001` on `global` is the right id (it answers with a quota error, while `us-east5` returns 404), but project `creatorpltfrm` has a quota of 0 for `global_online_prediction_requests_per_base_model` on `anthropic-claude-haiku-4-5`, so every call gets 429. Partner models usually need a quota increase request, which free trial projects may not be granted. Options: request the increase, or run scripts on Gemini until it lands (a plan section 6 change, so it needs a yes). The adapter is built and returns `quota`, so nothing else waits on this until WP10 | DECIDED 2026-09-19: scripts run on Gemini 3.1 Flash-Lite until the Haiku quota is granted (one line in the script generator definition). The script price stays 6 credits; the provider cost is lower | |
| D17 | Rewrite pass latency against the 1500ms budget (invariant 11) | Measured 2026-09-18 from the dev machine in India: Gemini 3.1 Flash-Lite answers a rewrite in about 1.26 to 1.3s warm and 2.1 to 2.8s on the first calls (auth and connection setup); gpt-oss-20b in 0.9 to 2.5s with `reasoning_effort: low`. Without low reasoning gpt-oss spent its whole token ceiling reasoning and returned nothing. The engine keeps the budget, so a cold or slow call falls back to the deterministic brief, which is safe but loses the rewrite. Options: measure again from the deployed region before deciding; warm the Vertex token and connection at boot; hedge by starting the second provider at about 900ms instead of after the first fails. Hedging changes how the "bounded retry" of invariant 11 works, so it needs a yes | OPEN. Boot warming is built (2026-09-24, `warmProviders`): the web process warms as soon as it builds the providers, since the rewrite runs in the request, and the worker warms at boot. Measured again from the dev machine on an image rewrite of 250 output tokens: cold 1.7 to 3.7s, warmed 1.45 to 1.65s with an 8s outlier. So warming removes the connection penalty but the median still sits at or just over 1500ms, and the fallback still fires often. What is left is the budget itself (invariant 11, so it needs a yes), hedging the second provider at about 900ms, or a shorter rewrite ceiling per compiler profile: the image rewrite asks for 250 output tokens, and latency scales with them | |

| D18 | Image model, since no Imagen is served to this project | Checked 2026-09-24 on project `creatorpltfrm`: `imagen-4.0-fast-generate-001`, `imagen-4.0-generate-001`, `imagen-4.0-ultra-generate-001` and `imagen-3.0-fast-generate-001` all return 404 in `us-central1`, `global`, `us-east4`, `asia-south1` and `europe-west4`, and the publisher list of 133 models contains no Imagen entry. Gemini's image models are GA: `gemini-3.1-flash-lite-image` and `gemini-3.1-flash-image` on `global`. They bill the picture as output tokens, not per image, so plan section 6 needed remeasuring: one 4:5 picture is 1120 output tokens, INR 2.96 on Flash-Lite Image and INR 5.91 on Flash Image, against the INR 1.76 the plan assumed for Imagen 4 Fast | DECIDED 2026-09-24 after comparing one picture from each model side by side: `gemini-3.1-flash-lite-image`. Flash Image composes better but costs twice as much, which would leave a thumbnail set at INR 17.73 against INR 18.00 of credits. Markups fall to 2.5x on an image and 2.0x on a thumbnail set, so the credit rates stay as they are. Switching back to Imagen, or up to Flash Image, is `IMAGE_ADAPTER` in the generator definitions plus a rate card entry | |

**What D1 means for the rest of the plan:**
- **Budget.** Vercel, R2, Postgres and Redis are cash lines. The costing in plan section 6 carries only the domain as cash, so the build budget table needs a cash line per service. The Vercel and R2 lines may be zero on free tiers, but check whether Vercel Hobby terms allow an investor demo, since they restrict commercial use.
- **Streaming.** Vercel functions have a maximum duration, so the SSE route must expect to be cut off. The client reconnects, and falls back to polling job status. Text jobs finish well inside the limit, and video uses polling anyway.
- **Region.** Pin Vercel functions, Postgres, Redis and the render VM to one region, or every job pays cross region latency on every DB call.
- **Upside.** Infra is not tied to the trial credit's 90 day clock. Only provider calls are.

---

## 2. Amendments to plan.md

These touch section 4 or section 8, so per section 0 rule 4 they were raised before being implemented. All ten were accepted as proposed on 2026-09-15 and are applied in `plan.md` sections 4, 7, 8, 11, 12, 14, 15 and 16. The table keeps the reasoning.

| # | Issue found | Proposal |
|---|---|---|
| A1 | Section 8 says `workspace_id` on every table, "no exceptions", but `users`, `templates`, `template_previews`, `compiler_profiles`, `video_scenes`, `renditions`, `post_targets` do not have it | Add `workspace_id` (denormalised) to `video_scenes`, `renditions`, `post_targets`. Declare `users`, `templates`, `template_versions`, `template_previews`, `compiler_profiles`, `metering_rates`, `music_tracks` as global catalog tables, readable only through `db.catalog.*`, written only by seed |
| A2 | `workspaces.video_seconds_used` is a mutable counter. That is invariant 6 broken for the second currency | Add `currency ('credits' \| 'video_seconds')` to `credit_ledger`. Same hold, settle, refund semantics. Workspace keeps cached balances for both, updated in the same transaction as the ledger row |
| A3 | Nothing stops a retried worker from settling or refunding twice | Unique index on `credit_ledger (job_id, currency, reason)` for hold, settle, refund. Settle writes `+(held - actual)`, so the balance never shows a partial charge |
| A4 | `CanonicalRequest` and `compiled_prompts` carry a template version, but `templates` has no version | Split into `templates` (identity) and `template_versions` (immutable config rows) |
| A5 | The week 3 checkpoint says confirm all 14 invariants, but 9 lands in week 7, 12 in week 4, 13 in weeks 5 to 6, 14 in weeks 4 to 6 | At week 3, invariants 1 to 8, 10, 11 are implemented and tested. 9, 12, 13, 14 have schema and seams in place and are checked in the week they are built |
| A6 | Moderation is scheduled for week 4, but the week 3 exit dispatches generations. Invariant 10 would be broken for a week | Move the text pre check on the compiled prompt into week 3 (WP11). Output post check and image checks stay in week 4 |
| A7 | Composer produces per platform variants, but `post_targets` has nowhere to store them | Add `post_targets.body jsonb` and `post_targets.rendition_id` |
| A8 | If the worker dies between the platform publish call and writing `platform_post_id`, the target is claimed with no post id | Boot sweep marks it `needs_verification` (checked against the account's recent media, or by hand). Never re-attempted. Invariant 9 implies this; make it explicit |
| A9 | Text streams to the user before the moderation post check runs | Stream is shown in a "checking" state. Copy and schedule unlock only at COMPLETE. BLOCKED replaces the content with the category and the refund ledger line |
| A10 | The verbatim transaction inserts the ledger row before the job row, so a foreign key from `credit_ledger.job_id` to `jobs.id` fails | Insert the job first, in the same transaction. The balance check still rejects before any job exists, and a plain foreign key keeps the ledger honest |

Small fixes, also applied: `jobs.status` uses the uppercase enum from `packages/contracts`, not lowercase strings. "Library" appears in seed data but not in the destination list; it is a tab inside Studio.

Consequences carried into the schema with A2 and A1: `jobs` gains `video_seconds_held` and `video_seconds_settled`, `template_previews` keys on `template_version_id` (a preview is real output from one version), and `compiled_prompts` gains `parent_id` for user edits.

### Accepted 2026-09-16, applied in WP4

| # | Issue found | Proposal |
|---|---|---|
| A11 | A1 made `users` a catalog table "written only by seed", but sign in (WP4) writes at runtime: Auth.js creates users and writes sessions and verification tokens. Those auth tables are neither tenant data nor catalog | Add a third category, identity tables (`users`, `sessions`, `verification_tokens`), written only by the auth layer inside `packages/db`. For the demo, sign in is restricted to users the seed created, so no stranger can create an account (plan section 3, "the line") |

---

## 3. Things only people can do (start today)

These have lead times and gate the week 1 spikes. None of them can be done from code.

| Item | Gates | Note |
|---|---|---|
| Google Cloud project, billing budget with alert at 70 percent, Vertex AI API enabled | Everything | Never an AI Studio key |
| Enable partner models in Model Garden: Claude Haiku 4.5, gpt-oss-20b | Script generator, second compile provider | Partner models are enabled per project and need terms accepted |
| Confirm Veo 3.1 Lite and Imagen 4 access and quota on the project | Veo spike | Check quota on day one, not in week 5 |
| Meta developer app, Instagram Business or Creator accounts, app roles for the team accounts | Instagram spike | Developer mode only works for accounts holding an app role |
| LinkedIn developer app with Share on LinkedIn and Sign In with LinkedIn (OpenID Connect) | LinkedIn spike | Needs `w_member_social` |
| Domain | Auth, OAuth redirect URIs | |
| Vercel, Cloudflare R2, Postgres and Redis accounts (D1, D1b) | WP6 | Cash lines per D1 |
| Email sender for magic links, DNS on the domain | Sign in | |
| Fix the demo date | Everything works backwards from it | Provider calls must fall inside the credit's 90 day window |
| Start posting from the demo accounts | Insights in week 8 | Native apps are fine, does not need our code |

---

## 4. Engineering design notes

### 4.1 Repo additions to plan section 10

| Path | Holds | Why it is needed |
|---|---|---|
| `packages/core` | Ledger, job engine, generator registry, scheduler | Plan layout has no home for them |
| `packages/storage` | S3 compatible client, signed URLs | R2 speaks the S3 API. Signed URLs feed Instagram container creation |
| `packages/config` | Env schema, metering rates loader, logger with correlation id | |
| `spikes/` + `docs/spikes/` | Throwaway spike scripts and their written findings | Week 1 exit is "answered in writing" |
| `infra/eval/` | The 20 intent set and harness | |

### 4.2 Tenancy

`packages/db` exports `scoped(workspaceId)`, which returns table accessors that inject `workspace_id` into every where clause and insert. The raw client is internal to the package. ESLint `no-restricted-imports` blocks importing the raw client or drizzle outside `packages/db`, and blocks provider SDKs outside `packages/adapters` (invariant 3). One test proves a scoped accessor cannot read another workspace's rows.

### 4.3 Ledger and jobs

- `createJob(ws, generatorKey, input)`: one transaction. Lock the workspace row, compute the estimate from `metering_rates`, reject if insufficient, insert hold rows, update cached balances, insert the job. After commit, `queue.add(jobClass, { jobId }, { jobId })`. If enqueue fails after commit, the job sits QUEUED in Postgres and the sweep picks it up.
- Worker: COMPLETE calls `settle(jobId, actual)`. BLOCKED, FAILED, CANCELLED call `refund(jobId)`. Both idempotent through A3. The `cost_telemetry` row is written in the same transaction.
- Boot sweep: QUEUED jobs are re-enqueued (BullMQ dedupes on jobId). Stale RUNNING inference and render jobs are re-enqueued; this can cost provider money but never charges the user twice. Due publish targets are enqueued. Claimed targets with no post id go to `needs_verification` (A8). Cached balance is checked against `SUM(ledger)` per workspace and any mismatch is logged loudly.

### 4.4 Orchestration engine

The central design choice: **the rewrite model only rewrites free text slots. It never sees or emits the constraint block.** Stage 3 renders the final prompt deterministically from slots plus constraints, so the model cannot drop a platform constraint or change precedence.

| Stage | Function | Behaviour |
|---|---|---|
| 1 | `assemble(req, ctx)` | Pure function. Produces slots: task, subject, audience, pillars, tone, brand, style, platform constraints, negatives. Snapshot tested |
| 2 | `rewrite(slots, { budgetMs: 1500 })` | Compile model returns rewritten free text slots as JSON. AbortController on the budget, one retry if time remains, schema validated. Any failure returns stage 1 slots with `fallbackUsed = true`. Never throws, never meters a credit |
| 3 | `enforce(slots, req)` | Applies precedence (safety > platform > explicit user > template > profile) to structured params, strips prohibited words again, renders text through the compiler profile |

- Explicit user instructions come from structured params and UI controls. Free intent text is treated as subject. This keeps precedence deterministic.
- Every compile persists a `compiled_prompts` row with full lineage. A user edit writes a new row with `user_edited = true` and a parent id, and the moderation pre check runs again.
- Language seam: `resolveRoute(language, outputType)` returns compiler profile and model. Only `en` is registered.

### 4.5 Adapters

- Normalised interfaces in `packages/contracts`: `TextAdapter` (stream plus usage), `ImageAdapter`, `VideoAdapter` (submit and poll, because video is a long running operation), `VoiceAdapter` (audio plus word timepoints), `ModerationAdapter`, `Publisher` (prepare, publish, status, metrics).
- Errors normalise to `{ code, category: 'retriable' | 'reauth' | 'terminal' | 'quota' }`. The raw provider error is logged, never returned.
- Every adapter has a `fake` implementation, selected by `PROVIDERS=fake`. Local dev, CI and all UI work run on fakes by default, so spending credit is always an explicit choice. The stubbed second video provider (FR-VD-17) is separate from the fake and is wired but never called.
- Model ids and rates live in config (section 17), never in code.

### 4.6 Render pipeline

Veo scene clips (video only) are normalised to 1080x1920 or 720x1280 at 30fps, then concatenated. TTS voiceover is added, with a music bed ducked under the voice. Captions are generated as ASS from the script, with timings from TTS timepoints (invariant 13, no transcription), and burned in with libass using the pinned font set. Logo and brand overlay are applied, and output is H.264/AAC to the Reels spec. The storyboard preview is one still per scene, from the image model in D18. The week 1 spike confirms TTS timepoint support before any of this is built.

### 4.7 Publishing

- Instagram: create container with a signed media URL, poll until finished, **claim**, `media_publish`, then write `platform_post_id` immediately. Container creation is safe to retry; only the publish call sits behind the claim.
- LinkedIn: register upload, upload, **claim**, create post, write id.
- Claim: `UPDATE post_targets SET status = 'claimed', claimed_at = now(), attempt_count = attempt_count + 1 WHERE id = $1 AND status IN ('pending', 'retry_scheduled') AND platform_post_id IS NULL RETURNING *`. Proceed only if a row comes back.
- Signed URL expiry must outlast Instagram's container processing time.

---

## 5. Work packages

Weeks 1 to 3 are detailed. Weeks 4 to 8 are scoped and get re-planned in detail at the week 3 checkpoint.

### Week 1: Foundation and spikes

| WP | Owner | Scope | Done when |
|---|---|---|---|
| WP1 Repo scaffold | A | `git init`, pnpm + Turborepo, strict tsconfig, ESLint with import boundaries, Vitest, docker compose (Postgres, Redis), env schema, pino logger with correlation id, CI (typecheck, lint, test) | `pnpm dev` runs web and worker locally against compose. CI green |
| WP2 Contracts | A | Section 9 types, adapter interfaces, error categories | Imported by web and worker |
| WP3 Schema | B (A reviews ledger and job tables) | Full section 8 schema as amended. Every table in the first migration. Scoped helper, catalog helper, seed skeleton with grants through the ledger | Migration runs clean. Lint blocks unscoped access. Cross workspace read test passes. Duplicate settle rejected by the unique index |
| WP4 Shell and auth | B | Next.js App Router, magic link sign in (D6), S-01, S-02, navigation for the 7 destinations, header with credits and video seconds, design tokens, empty frames per screen. S-02 asks name and timezone; the primary goal question moves to onboarding (WP12), where each answer visibly configures something | User signs in, creates a workspace, lands on the shell (week 1 exit) |
| WP5 Spikes | A | Instagram and LinkedIn publish from a script (done: `docs/spikes/instagram.md`, `docs/spikes/linkedin.md`). ffmpeg ASS captions at 9:16 with the font stack including Noto Sans Devanagari. One 8 unit Veo Lite clip with the billing line read (17.1). 720p vs 1080p on one prompt. TTS timepoints | Each question answered in `docs/spikes/*.md` (week 1 exit) |
| WP6 Infra | A | Vercel project, R2 bucket, Postgres and Redis per D1b, GCE VM with ffmpeg and fonts (Dockerfile, systemd), one region throughout, deploy path for web and worker, budget alert | Worker on the VM consumes a no-op job enqueued from the deployed web |

### Weeks 2 to 3: Orchestration and job model

| WP | Owner | Scope | Done when |
|---|---|---|---|
| WP7 Ledger and jobs | A | `createJob` transaction, idempotent settle and refund, grant script, versioned `metering_rates`, three BullMQ queues, worker skeleton, boot sweep, `cost_telemetry`. Built 2026-09-18: `createJobWithHold`, `settleJob`, `refundJob` in `packages/db`; submit, process and sweep in `packages/core`. `workspaces.video_seconds_cap` is not enforced yet; the granted balance already caps usage | Insufficient balance rejects before a job exists. Double settle is a no-op. Worker killed mid job is recovered by the sweep. Cached balance equals ledger sum. All four covered by tests, with concurrency on real Postgres |
| WP8 Text adapters | A | Fakes for every adapter kind. Gemini Flash-Lite and Haiku through Vertex. gpt-oss-20b as second compile provider. Error normalisation. Built 2026-09-18 in `packages/adapters`: `createTextAdapters('fake' \| 'real')`, model ids in `models.ts`, fakes returning real PNG, WAV and MP4 files. Live contract tests pass for Gemini and gpt-oss (`openai/gpt-oss-20b-maas`, `us-central1`, through the OpenAI-compatible endpoint). Haiku is blocked on quota (D16) | Same call runs fake or real behind one flag |
| WP9 Registry and API | A + B | Generator registry, one generate route keyed by generator, estimate endpoint, job SSE route. Built 2026-09-18: registry and the six generator definitions in `packages/core/src/generators`, `startGeneration` and `estimateGeneration` in `packages/core`, routes under `/api/w/[workspaceId]`. Generators have no worker handler yet, so their jobs fail and refund in full until WP10. The seam for compile and the moderation pre check sits between pricing and the hold in `startGeneration` | Adding a generator touches no route file (FR-GN-02) |
| WP10 Orchestration | A | Stages 1 to 3, artifact persistence, edit versioning, language seam, compiler profiles seeded as versioned rows . Built 2026-09-18 in `packages/orchestration`: directives from five sources resolved by precedence, a deterministic brief, the rewrite pass (Flash-Lite then gpt-oss, minimal reasoning, 1500ms in total), requirements rebuilt from the settings after any rewrite or edit, edits as child versions, the language seam (`routeLanguage`, profiles keyed `<type>.<language>`). Compiler profiles and a default template per output type are seeded as versioned catalog rows. Text generators (script, hooks, captions) run in the worker, stream deltas and store output inline on `outputs` until object storage exists. The dispatch path already runs the moderation pre check through the fake adapter | Forced 1500ms breach falls back, generation succeeds, no credit used. Assembly snapshot tests. Precedence tests |
| WP11 Moderation pre check | A | Text pre check on compiled prompt (A6). Built 2026-09-18: every dispatch checks the compiled prompt and records the verdict in `moderation_events`; a failed check refuses the dispatch (fail closed, 503). Google adapter for text (Natural Language `moderateText`, blocking at 0.8 confidence on harmful categories only) and images (Vision SafeSearch), chosen by `MODERATION`, separate from `PROVIDERS` | A blocked compiled prompt never creates a job or a hold |
| WP12 Onboarding and profile | B | FR-ON flow, one question per screen, each answer visibly configures something. S-17 with version history. Built 2026-09-18: eight questions at `/w/[id]/onboarding` with a live panel of the brief lines the compiler writes from the answers; the Brand screen edits the profile, saves version N+1 only when something changed, and lists the history with what each version changed. Home asks a workspace without a profile to start | Editing the profile creates version N+1, and the next compile shows it in lineage |
| WP13 Brand kit | B | S-18: logo upload, 3 colours, typography, tagline. Versioned. Built 2026-09-19 on the Brand screen: logo upload (PNG or JPEG, moderated, resized to 512px, no SVG), up to three colours, a typeface from the fonts the renderer has (Poppins, Noto Sans Devanagari), tagline, live brand card, history. Saves version N+1 only on a real change; a logo must be one this workspace uploaded | Next compile shows new brand kit version in lineage |
| WP14 Studio and disclosure | B | Studio frame, cost before submit, streamed output, navigable away while the job continues. PROMPT disclosure: collapsed, viewable, editable, designed. Built 2026-09-19: Studio with generator choice (image, thumbnail and video shown as soon), intent, platform, script length, caption platforms and a tone override; cost before submit; the PROMPT disclosure collapsed by default with brief, requirements, edit as a new version and why each setting won; streamed output shown as checking with copy locked until done; hooks, titles and captions laid out by shape; recent jobs and a ?job= link to return. Scripts run on Flash-Lite (D16) | Week 3 exit: intent, see prompt, edit, dispatch, held, settled, ledger line visible |
| Checkpoint | both | Re-baseline against velocity. Invariant audit per A5. Cut decisions per plan section 12 | |

### Week 4: Text, image, thumbnail

| WP | Owner | Scope |
|---|---|---|
| WP15 | A | Image adapters. Aspect ratio from target platform, never asked. Built 2026-09-24 on `gemini-3.1-flash-lite-image` instead of Imagen (D18): one adapter per configured image model behind PROVIDERS, a size reader for the returned bytes, and handlers that run the compiled prompt as persisted, take the frame from its resolved settings, store one row per picture in object storage and refund a refusal to draw as BLOCKED. Thumbnails are always three variants; an image is however many were priced. The Studio draws and shows them |
| WP16 | A | Moderation post check on text and image. Refund with category stated. Built 2026-09-24: the check runs before anything is kept, so a blocked generation never reaches the outputs table, the bucket or a public URL. The job sits in MODERATING while it runs, which is the Studio's "Checking" state with copy locked, and streamed text is dropped from the screen on a block rather than left behind. Verdicts are recorded against the job (migration 0005 allows `subject_type = 'job'`, since a blocked output is never stored). A block refunds in full as BLOCKED with the category shown; a check that cannot run refunds in full as FAILED with `MODERATION_UNAVAILABLE`, because an unchecked output is never released either |
| WP17 | B | Script, hook, caption generators. Per platform caption variants with live length indicators (S-10, S-11). Built 2026-09-24 on the generators from WP10: each caption is its own card, editable in place so the indicators are live, counting characters and hashtags against the published limits, amber from nine tenths and red past it with a line saying it cannot be posted as it is. The edit is local to the screen and never stored: what is kept is what the generator made, and the way out is Copy or the Composer. A script says how many words it is and how long that takes to say, against the length that was asked for. Hooks and titles carry a plain character count, since no platform publishes a limit on them. The limits themselves moved into `@cgp/contracts`, where the compiler's requirement lines, the publish checks and the indicators all read the same numbers |
| WP18 | B | Text compositing layer per D12 (S-12). Built 2026-09-24: a spec of up to four vector text blocks, every measurement a fraction of the picture so one spec renders at any size, wrapped with the same font files that rasterise it and composited over the picture the model drew. Kept as that output's rendition, one per platform, replaced whenever the spec changes; the picture underneath is never touched, so a layer can be redone or dropped. The Studio edits it over a live preview in container query units, which is the same fractional maths the server uses. Invariant 12 holds end to end: the model is told never to draw words, and the words are drawn here |
| WP19 | B | 8 to 12 templates as versioned rows. Preview pipeline runs each template through its real generator and stores `is_real_output = true`. Cost band shown. Built 2026-09-25: ten templates plus the plain one per output type, seeded as version 1 rows whose style params are real template source directives (an angle, and the shape parameters each compiler profile already reads), so choosing one changes the compiled prompt rather than the label. Compiler profiles went to v3 for the angle line. The gallery lives inside the Studio, since plan section 13 fixes the destination set and picking a template is the first step of making something: each card shows its real preview, its cost band and what it costs in credits. The preview pipeline (`pnpm --filter @cgp/worker previews <workspace>`) runs each template through its own generator in process, spends that workspace's credits and records what came back. It queues nothing, which is load bearing: the first run did enqueue, a worker picked the same jobs up, generated them again against the real providers and refunded three of them out from under the run, since a job already RUNNING is accepted by design for crash recovery and nothing downstream stops two processes running one job; a template that cannot produce output has no preview and the card says so, rather than showing stock. Migration 0006 adds the gallery's title and description, lets a preview hold words instead of a URL, and allows one preview per template version |
| WP20 | B | Eval harness: 20 intents, compiled vs raw control, blind side by side export, edit distance captured when a Studio output is accepted. Built 2026-09-25: twenty intents written the way a creator types, each generated twice through the same model with the same ceiling, once from the compiled prompt and once from the bare words. The raw arm is the only place raw mode exists and is never offered to a creator. A run charges no credits and stores no output, since it is research: it writes results, a blind page and a key to `evals/<stamp>/`, and `eval:score` turns the judge's verdicts into the win rate. Copying an output in the Studio records it as accepted, with the Levenshtein distance and rate against what the engine wrote (migration 0007, `output_edits`); the output itself is never changed. First run 2026-09-25: 20 intents, no failures, about a rupee, 7 of 20 compiles fell back on the rewrite (D17). The lift number waits on a person judging the blind page |

### Weeks 5 to 6: Video

| WP | Owner | Scope |
|---|---|---|
| WP21 | A | Veo Lite adapter (submit and poll) plus wired stub second provider. Built 2026-09-25 on the WP5 spike's findings: `predictLongRunning` to submit, `fetchPredictOperation` to poll, nothing waiting in a loop, since the worker owns the waiting and a render job has to survive a restart. A refused clip comes back done and empty, so a safety filtered or provider rejected operation is reported as `failed` with a category rather than thrown as an error to retry. The clip is measured from its own MP4 header rather than from the request: one adapter serves every job, and a worker that restarts has forgotten what it asked for. `generateAudio: false`, because voiceover and music are added in the render and audio bills higher. The second provider is a stub that refuses plainly (FR-VD-17): it exists so the seam is real, and it never pretends. Verified with one real 8s 720p clip through the adapter, INR 21 |
| WP22 | A | Scene model and sequencing, up to 3 scenes at 8 seconds, per scene regenerate. Built 2026-09-25: a compiled prompt is broken into scenes by the engine, not the generator (invariant 4), using a `scenes` block added to the video compiler profile at v4, with a deterministic fallback so a slow planner costs a duller reel rather than the render. Scenes are rendered one after another, since the provider meters by the minute and a burst loses the whole reel rather than one shot. The output row and the scene rows exist before the first clip, so a render that dies halfway leaves a readable record of what was made. Held on the seconds asked for and settled on the seconds delivered, so a refused scene is never charged for; every scene refused is a full refund, as BLOCKED when that is why. Regenerating one scene is its own job holding its own eight seconds: it writes a new object rather than overwriting the clip the creator is looking at, and the retry is counted |
| WP23 | A | TTS voiceover with timepoints, voice tier picked from WP5 findings. Built 2026-09-25 on `en-IN-Neural2-A`, which the WP5 spike showed returns timepoints at SSML marks; Chirp 3 HD sounds better and returns none, so it cannot time captions (docs/spikes/tts.md). The script goes as SSML with a mark before each segment and one at the end, and the adapter refuses a voice that ignores the marks rather than handing back timings of zero. What is said is written by the engine from the compiled prompt and the planned scenes (profile v6, one line per scene, about eighteen words each, which is also one caption segment). There is deliberately no deterministic fallback for narration: a made up voiceover puts words in the creator's mouth, so a reel with no usable lines stays silent and still renders. The render mixes the voice over the scenes and ducks the bed under it with sidechaincompress. Timings are kept on the output for the captions in WP25 |
| WP24 | A | Render worker per 4.6. Music catalog with licence per track. Built 2026-09-25: scene clips are scaled and cropped to one frame at 30fps, concatenated, a licensed bed laid under them and the brand logo cornered, out as H.264 high with AAC and `+faststart` to the Reels spec. The reel is cut to the sum of the scene durations rather than with `-shortest`: a looped bed has no end, and ffmpeg will happily encode one for as long as it is left running, which it did for eighteen minutes before this was found. A machine with no ffmpeg keeps the scenes and skips the reel, since the clips are already paid for. Voiceover and burned in captions are the two pieces still to come (WP23, WP25); the audio graph already mixes and the video graph already filters, so both join what is there. The music catalogue records source, licence and attribution per track and there is no way to add one without them (FR-VD-08). No audio ships in the repository: tracks are added with `pnpm --filter @cgp/worker music:add`, and until one is, a reel renders without a bed. FFMPEG_PATH is in the environment and in the test config, so the render tests run rather than silently skipping |
| WP25 | A + B | Captions from script to ASS, styled per template |
| WP26 | B | Storyboard preview then commit. Per second cost updating live |
| WP27 | B | Video templates with real rendered previews, muted and looping |

### Week 7: Publishing, Calendar, Composer

| WP | Owner | Scope |
|---|---|---|
| WP28 | A | OAuth for both platforms, envelope encrypted tokens, S-03, S-19. Publishing slice (2026-09-18): tokens encrypted and imported from .env by `accounts:import`, Accounts screen lists them; the OAuth connect flow is still to do |
| WP29 | A | Instagram publisher per 4.7. Built in the publishing slice |
| WP30 | A | LinkedIn publisher per 4.7. Built in the publishing slice, text and image posts, little text escaping |
| WP31 | A | Scheduler, claim before call, the four error classes, sweep extended for publish. Publishing slice: post now with claim before call, the four classes onto target statuses and needs_verification, all tested; scheduling and automatic retries still to do |
| WP32 | A | Rendition cache per platform spec |
| WP33 | B | Composer (S-13) with per platform preview tabs and inline validation. Publishing slice: a page with text, image upload, account choice, live per target status; per platform previews and the layer form still to do |
| WP34 | B | Calendar week view (S-07) with status chips and render state |
| WP35 | B | Sync centre (S-20), platform errors verbatim |

### Week 8: Demo assembly

As `plan.md` section 11, plus Home (S-04), which depends on Calendar and Accounts and so cannot be filled earlier. No new capability.

---

## 6. Working with Claude Code

Claude Code builds both streams. A and B in the tables are stream labels, not people. The team reviews each package before merge.

- One work package per session and branch. The "done when" column is the definition of done.
- After WP2 lands, streams A and B run as parallel sessions in separate worktrees, since contracts is the only cross stream dependency.
- Spikes (WP5) and anything needing a real account, OAuth consent or accepted terms need a person at the keyboard. Claude writes the scripts, a person runs the parts that need credentials.
- Real provider calls are opt in per command. Fakes are the default everywhere.
- Anything that would touch section 4 of `plan.md` stops and is raised, as the plan requires.

## 7. Next steps

1. Judge the evaluation set (`evals/<stamp>/blind.html`) and score it. Plan section 12 makes this the week 4 checkpoint: if the lift against the raw control is not visible, that is a product finding worth more than the demo, and weeks 5 and 6 should be reconsidered before they are spent.
2. Then weeks 5 and 6, video: WP21 to WP27. Veo billing is still unread, and a 24 second reel at 1080p costs about INR 114, so that line matters before WP21 spends anything. Real checking needs `MODERATION=google` in the environment; without it the post check runs against the fake and passes everything. The publishing slice (parts of WP28 to WP33) is built; the first real posts through it are the user's to make with PUBLISHING=real.
2. Decide D1b before WP6, D3 before WP11, and D16 and D17 before the week 3 exit.
3. Start the section 3 items. They have the longest lead times.
