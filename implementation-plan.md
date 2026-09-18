# Demo Build: Implementation Plan

**Companion to `plan.md`.** `plan.md` says what and why. This file says how, in what order, and what has been decided. Where the two disagree, `plan.md` wins.

**Status:** 2026-09-16. WP1 to WP4 built. Amendments A1 to A11 accepted and applied to `plan.md`. Items marked OPEN need an answer before the work package that depends on them.

---

## 1. Technical decisions

| # | Decision | Recommendation | Status | Blocks |
|---|---|---|---|---|
| D1 | Hosting topology (open item 17.2) | As written in plan section 5: Vercel for web, R2 for storage, one GCE VM for worker + ffmpeg | DECIDED 2026-09-14 | |
| D1b | Postgres and Redis providers | Postgres: Neon, Singapore (`ap-southeast-1`), Postgres 18, in use for development. Pin Vercel functions and the render VM to Singapore too. Check the Neon plan before the demo: free tier compute suspends when idle, and the first query after that is slow. Redis still open: smallest managed instance in the same region, not billed per command, since BullMQ polls constantly | Postgres DECIDED 2026-09-16, Redis OPEN | WP6 |
| D2 | Publishing pair (open item 17.7) | Instagram + LinkedIn | DECIDED 2026-09-14 | |
| D3 | Moderation endpoint (not named in plan) | Cloud Natural Language `moderateText` + Vision SafeSearch. Both GCP, credit eligible. Verify free tier on the day | OPEN | WP11 |
| D4 | Monorepo | pnpm workspaces + Turborepo, Node 24 LTS, TypeScript 6.0 strict, ESLint 9. TypeScript 7 and ESLint 10 wait until typescript-eslint and eslint-config-next support them | DECIDED in WP1 | |
| D5 | ORM and migrations | Drizzle + drizzle-kit. SQL shaped, supports `FOR UPDATE`, typed | proposed | |
| D6 | Auth | better-auth, email magic link, database sessions. Chosen over Auth.js v5, still beta (`5.0.0-beta.32`), because better-auth is a stable release and its magic link option refuses unknown emails, which is exactly A11. Without an email sender the link goes to the server log; a real sender is needed before anyone outside the team signs in | DECIDED in WP4 | |
| D7 | UI | Tailwind 4 with design tokens in CSS, primitives in `packages/ui`. shadcn/ui is deferred until a screen needs dialogs, menus or complex form controls | DECIDED in WP4 | |
| D8 | Queue | BullMQ, one queue per job class (`inference`, `render`, `publish`) in one worker process | proposed | |
| D9 | Streamed output | Worker publishes tokens to Redis pub/sub, web exposes an SSE route, client falls back to polling job status | proposed | |
| D10 | Provider SDKs | `@google/genai` in Vertex mode (Gemini, Imagen, Veo), `@anthropic-ai/vertex-sdk` (Haiku), `@google-cloud/text-to-speech` | proposed | |
| D11 | Token encryption | AES-256-GCM per token, data key wrapped by a key held in Vercel and worker env, never in the database | proposed | |
| D12 | Image text layer | SVG layer spec stored as JSON, edited in browser, flattened in worker with resvg using the same font files | proposed | |
| D13 | Tests | Vitest. Database tests run on PGlite (in-memory Postgres, same constraints and triggers, no docker). Concurrency tests, such as two writers racing for a hold, need the docker Postgres from WP7 on | DECIDED in WP3 | |
| D14 | Exchange rate (open item 17.5) | 88, stored once in config, every rupee figure derived from it | proposed | |
| D15 | Facebook Page publishing | Not for this demo. It would have cost about half a week, and the API posts only to Pages, never personal profiles, so it helps fewer individual creators than Instagram and LinkedIn do. Post-demo item: same Meta app, adding Facebook Login for Business (`pages_show_list`, `pages_manage_posts`, `pages_read_engagement`) | DECIDED 2026-09-18: dropped | |

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

Veo scene clips (video only) are normalised to 1080x1920 or 720x1280 at 30fps, then concatenated. TTS voiceover is added, with a music bed ducked under the voice. Captions are generated as ASS from the script, with timings from TTS timepoints (invariant 13, no transcription), and burned in with libass using the pinned font set. Logo and brand overlay are applied, and output is H.264/AAC to the Reels spec. The storyboard preview is one Imagen Fast still per scene. The week 1 spike confirms TTS timepoint support before any of this is built.

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
| WP7 Ledger and jobs | A | `createJob` transaction, idempotent settle and refund, grant script, versioned `metering_rates`, three BullMQ queues, worker skeleton, boot sweep, `cost_telemetry` | Insufficient balance rejects before a job exists. Double settle is a no-op. Worker killed mid job is recovered by the sweep. Cached balance equals ledger sum |
| WP8 Text adapters | A | Fakes for every adapter kind. Gemini Flash-Lite and Haiku through Vertex. gpt-oss-20b as second compile provider. Error normalisation | Same call runs fake or real behind one flag |
| WP9 Registry and API | A + B | Generator registry, one generate route keyed by generator, estimate endpoint, job SSE route | Adding a generator touches no route file (FR-GN-02) |
| WP10 Orchestration | A | Stages 1 to 3, artifact persistence, edit versioning, language seam, compiler profiles seeded as versioned rows | Forced 1500ms breach falls back, generation succeeds, no credit used. Assembly snapshot tests. Precedence tests |
| WP11 Moderation pre check | A | Text pre check on compiled prompt (A6) | A blocked compiled prompt never creates a job or a hold |
| WP12 Onboarding and profile | B | FR-ON flow, one question per screen, each answer visibly configures something. S-17 with version history | Editing the profile creates version N+1, and the next compile shows it in lineage |
| WP13 Brand kit | B | S-18: logo upload, 3 colours, typography, tagline. Versioned | Next compile shows new brand kit version in lineage |
| WP14 Studio and disclosure | B | Studio frame, cost before submit, streamed output, navigable away while the job continues. PROMPT disclosure: collapsed, viewable, editable, designed | Week 3 exit: intent, see prompt, edit, dispatch, held, settled, ledger line visible |
| Checkpoint | both | Re-baseline against velocity. Invariant audit per A5. Cut decisions per plan section 12 | |

### Week 4: Text, image, thumbnail

| WP | Owner | Scope |
|---|---|---|
| WP15 | A | Imagen 4 Fast and Imagen 4 adapters. Aspect ratio from target platform, never asked |
| WP16 | A | Moderation post check on text and image. Refund with category stated |
| WP17 | B | Script, hook, caption generators. Per platform caption variants with live length indicators (S-10, S-11) |
| WP18 | B | Text compositing layer per D12 (S-12) |
| WP19 | B | 8 to 12 templates as versioned rows. Preview pipeline runs each template through its real generator and stores `is_real_output = true`. Cost band shown |
| WP20 | B | Eval harness: 20 intents, compiled vs raw control, blind side by side export, edit distance captured when a Studio output is accepted |

### Weeks 5 to 6: Video

| WP | Owner | Scope |
|---|---|---|
| WP21 | A | Veo Lite adapter (submit and poll) plus wired stub second provider |
| WP22 | A | Scene model and sequencing, up to 3 scenes at 8 seconds, per scene regenerate |
| WP23 | A | TTS voiceover with timepoints, voice tier picked from WP5 findings |
| WP24 | A | Render worker per 4.6. Music catalog with licence per track |
| WP25 | A + B | Captions from script to ASS, styled per template |
| WP26 | B | Storyboard preview then commit. Per second cost updating live |
| WP27 | B | Video templates with real rendered previews, muted and looping |

### Week 7: Publishing, Calendar, Composer

| WP | Owner | Scope |
|---|---|---|
| WP28 | A | OAuth for both platforms, envelope encrypted tokens, S-03, S-19 |
| WP29 | A | Instagram publisher per 4.7 |
| WP30 | A | LinkedIn publisher per 4.7 |
| WP31 | A | Scheduler, claim before call, the four error classes, sweep extended for publish |
| WP32 | A | Rendition cache per platform spec |
| WP33 | B | Composer (S-13) with per platform preview tabs and inline validation |
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

1. WP5 (spikes) is next and needs the section 3 accounts. WP7's concurrency tests need a real Postgres: a Neon branch works.
2. Decide D1b before WP6 and D3 before WP11.
3. Start the section 3 items. They have the longest lead times.
