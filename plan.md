# Creator Growth Platform: Demo Build Plan

**Purpose of this file:** single source of context for Claude Code. Everything an agent needs to build the investor demo without re-reading the source documents.

**Build:** 8 weeks, 2 developers, English only, investor demo. Not a pilot, not a beta, not a soft launch.
**Baseline docs:** BRD v0.3, AI Model and Cost Strategy v0.1, Demo Build Implementation Plan v0.3, Demo Costing v0.3, Solution and User Flows v0.1, Feature Matrix (India).
**Rate used in all costs:** 88 INR per USD. Re-verify on any pricing decision.
**Amendments:** A1 to A10 accepted 2026-09-15 and applied below. Rationale in `implementation-plan.md` section 2.

---

## 0. How to use this file

1. Read sections 3, 4, 5 before writing any code. Section 4 is non-negotiable.
2. Every task in section 11 maps to a week and an owner (A = engine, B = surface).
3. FR-XX-NN identifiers reference BRD v0.3. A requirement not listed here is deferred, never deleted.
4. If a change touches anything in section 4, stop and raise it instead of implementing it.
5. Section 17 lists unverified figures. Do not hardcode any of them without checking first.

---

## 1. Product in one paragraph

An AI content platform for Indian creators and small teams. The user declares who they are at onboarding, picks a template, types plain intent in ordinary language, and the Prompt Orchestration Engine compiles that into a full provider prompt using the workspace profile, brand kit and target platform constraints. Output (script, captions, image, thumbnail, video) is generated asynchronously, metered against a credit ledger, moderated, scheduled on a calendar, and fanned out to multiple social accounts with independent per target status. Results feed back into planning.

The differentiator is not any single generator. It is the compiled prompt layer plus continuity of the loop. Both are only credible if they are visible and measured.

## 2. The loop

| Step | User does | System does | Screen |
|---|---|---|---|
| 1 Profile | Answers onboarding, corrects profile | Builds versioned workspace profile | Onboarding, Brand |
| 2 Plan | Fills a calendar slot | Suggests topics against declared pillars | Calendar |
| 3 Create | Types plain intent | Compiles prompt, generates, moderates | Studio |
| 4 Schedule | Picks targets and time | Validates per platform, holds credits | Composer |
| 5 Publish | Nothing | Publishes per target, classifies errors | Calendar, Sync |
| 6 Measure | Reads what worked | Fetches metrics, ranks against own baseline | Insights |

Step 6 feeds steps 1 and 2. That feedback edge is the product.

---

## 3. Demo scope baseline (locked)

Six decisions define the build. If any changes, the timeline changes with it rather than absorbing the difference.

| Decision | Position |
|---|---|
| Publishing targets | Instagram (Business/Creator) and LinkedIn member posting, both developer mode, team controlled accounts. Two different OAuth families on purpose |
| Video | In scope at MVP ceilings: budget tier provider, up to 3 scenes, 8 seconds per clip, one live provider plus a stubbed second adapter |
| Orchestration engine | In scope in full, including the compiled prompt disclosure (FR-TP-08, FR-PO-12) |
| Billing | Credit ledger with hold and settle. No checkout, no plans, no top up, no merchant of record. Credits granted by seed script |
| Personalisation | Declared onboarding plus brand kit. No corpus ingestion |
| Language | English only. Routing seam stays in code so Hindi is a configuration change later |

### In scope, built to the BRD requirement

| Capability | FR reference |
|---|---|
| Prompt Orchestration Engine | FR-PO-01 to 12, 16 |
| Onboarding and versioned workspace profile | FR-ON-01 to 11 |
| Brand kit | FR-BK-01, 03, 06 |
| Template gallery with real previews | FR-TP-01 to 08, 11 |
| Script, hook, caption, image, thumbnail generation | FR-GN-03 to 08 |
| Video generation end to end | FR-VD-01 to 11, 19 |
| Credit ledger and metering | FR-BL-02, 03, 04, 05, 07 |
| Publishing to two platforms | FR-PB-01 to 06, 08, 10, 16 |
| Calendar and Composer | FR-CL-01 to 03, 06 |
| Moderation | FR-MD-01 to 05 |

### Reduced, with the reduction stated

| Capability | Demo form |
|---|---|
| Multi tenancy | `workspace_id` on every table, every query scoped. Enforcement test suite not written |
| Roles | Owner and Editor only. Approval queue hidden (FR-ON-08). No audit log |
| Evaluation harness | 20 intent English set, run manually, with a raw prompt control retained |
| Token lifecycle | Long lived tokens issued once. No refresh worker. Expiry date recorded manually |
| Scheduling | Postgres remains source of truth. Reconciler reduced to a sweep on worker boot |
| Analytics | On demand fetch when Insights opens. Presented as thin because it is |
| Video ceilings | One hard per workspace seconds cap plus a prepaid provider balance |
| Caching | Rendition cache only. No prompt cache, no compilation hash cache |

### Out of scope entirely

X and YouTube publishing. Merchant of record, plans, checkout, invoices. Compliance surface (grievance process, DPDP erasure, retention lifecycle, advertising disclosure). Level 2 autonomous publishing. Trends and keyword research. Free logged out keyword tool. Corpus ingestion and derived voice profile. Hindi and Hinglish generation and Indic voice. Failure injection test suite.

### The line: when this stops being a demo

| Trigger | What must return first |
|---|---|
| Anyone outside the team gets access | Compliance surface. About 2 weeks plus legal advisory |
| Anyone pays anything | Merchant of record, tax position, full metering rules |
| Anyone uses it unattended | Failure injection suite, reconciler, token refresh, spend guards |
| User count past ~20, or daily usage | Enforcement layers, worker pool separation, caching |
| Publishing moves off team controlled accounts | The four platform approval tracks |

---

## 4. Non-negotiable invariants

These are load bearing. Each one converts a future rewrite into a future configuration change. Do not skip any of them for demo convenience.

1. **`workspace_id` on every table from the first migration.** Every query scoped at the data access layer. Retrofitting tenancy is a rewrite of every query and every test. The only exceptions are the global catalog tables marked in section 8, read through a separate catalog helper and written only by seed, and the identity tables (`users`, sessions, login tokens), written only by the auth layer inside `packages/db`.
2. **Postgres holds scheduling truth. Redis is transport only.** A queue wipe must be recoverable by a reconciler sweep.
3. **No provider response shape reaches application code.** Everything normalises at the adapter boundary, for text, image, video and voice.
4. **No generator composes its own prompt.** All prompt construction is owned by the orchestration engine.
5. **Render, inference and publishing are separate job classes**, even when they run in one worker process. The field is written now so the split is later a deployment change.
6. **Credit ledger is append only, for both currencies.** Credits and video seconds move only through ledger entries tagged with their currency. Balance is derived; the cached balance on `workspaces` changes only in the same transaction as its entry. Hold, settle and refund are unique per job and currency, so a retried settle or refund is a no-op.
7. **Credit hold commits inside the same transaction that creates the job.** Enqueue only after commit, with `job_id` as the idempotency key. Never charge from inside the worker.
8. **Compiled prompt artifact is persisted and versioned,** with lineage to intent, template version, profile version, brand kit version and compiler profile version.
9. **Claim before call on publishing.** A target holding a platform post id is never re-attempted. Double publishing ranks above failure to publish. A target found claimed with no post id after a crash moves to `needs_verification` and is never retried automatically.
10. **Moderation pre check runs on the compiled prompt before dispatch,** not on the output path only.
11. **The rewrite pass is degradable.** 1500ms budget, bounded retry, deterministic composition on breach. It must never fail a generation, block a dispatch or consume a credit.
12. **Text on images is composited as a vector layer.** The image model never renders headline text.
13. **Captions are generated from the script,** never transcribed from the finished render.
14. **Every template gallery preview is real output from that template.** No stock, no aspirational imagery. Video previews are real rendered video, muted and looping.

### The transaction boundary, verbatim

```sql
BEGIN;
  SELECT credit_balance FROM workspaces WHERE id = $1 FOR UPDATE;
  -- reject here if insufficient, before any job exists
  INSERT INTO jobs (id, workspace_id, status, credits_held)
    VALUES ($2, $1, 'QUEUED', estimate);
  INSERT INTO credit_ledger (workspace_id, job_id, currency, delta, reason)
    VALUES ($1, $2, 'credits', -estimate, 'hold');
  UPDATE workspaces SET credit_balance = credit_balance - estimate WHERE id = $1;
COMMIT;
-- enqueue only after commit, with jobId as the idempotency key
-- video jobs hold seconds the same way: currency 'video_seconds', video_seconds_balance
```

The job row is inserted before its ledger row so `credit_ledger.job_id` can be a plain foreign key (A10). Nothing commits unless both land.

---

## 5. Architecture and stack

| Component | Demo choice | Note |
|---|---|---|
| App and API | Next.js (App Router) + TypeScript on Vercel | Hobby or lowest paid tier |
| Workers | Node + BullMQ, one process | Job class field written regardless |
| Render worker | ffmpeg on one small always on box | Cannot be serverless. Provision in week 1, not week 5 |
| Database | PostgreSQL, single instance, paid tier | No free tier. Cold starts fail on demo morning |
| Queue | Redis, smallest managed instance | Transport only |
| Storage | S3 compatible, zero egress | See open item 17.2 on R2 vs GCS |
| Providers | Everything through the Gemini Enterprise Agent Platform (formerly Vertex). Never the AI Studio Gemini API | AI Studio bills the linked card, not the trial credit |
| Payments | None | Removed entirely |
| Observability | Structured logs with correlation ids spanning request, compile, job, render, provider call | No alerting. A person is watching |

### Runtime flow for a generation

```
intent + templateId
  -> canonical request (intent, template v, output type, target platform, profile v, brand kit v)
  -> orchestration engine
       stage 1: deterministic slot assembly
       stage 2: single model rewrite pass (1500ms budget, bounded retry, fallback to stage 1 output)
       stage 3: deterministic enforcement (precedence order below)
  -> moderation pre check on compiled prompt
  -> persist compiled prompt artifact
  -> credit hold in txn with job insert -> COMMIT -> enqueue
  -> worker: provider adapter call -> normalise -> moderation post check
  -> settle or refund -> output versioned with lineage
```

**Precedence order in the enforcement stage (FR-PO-06), resolved deterministically, never delegated to the model:**
safety and moderation policy > platform hard constraints > explicit user instruction > template default > workspace profile default.

### Performance targets (from BRD section 8, carried into the demo)

- Interactive responses under 500ms p95.
- Prompt compilation adds no more than 1500ms p95.
- Text generation first token within 4 seconds of dispatch.
- Image and thumbnail within 30 seconds p95.
- Storyboard preview within 45 seconds. Single scene render within 3 minutes p95.
- Scheduled posts dispatch within 60 seconds of scheduled time.

---

## 6. Model and provider stack

All slots run on one Google Cloud account against the trial credit. Every call routes through the Agent Platform.

| Slot | Model | Rate | INR |
|---|---|---|---|
| Compile pass | Gemini 3.1 Flash-Lite | $0.25 / $1.50 per 1M in/out | cached input at $0.025 |
| Compile pass, second provider | gpt-oss-20b | $0.07 / $0.25 per 1M | partner model, credit eligible |
| Script, English | Claude Haiku 4.5 | $1.00 / $5.00 per 1M | partner model, credit eligible |
| Captions and hooks | Gemini 3.1 Flash-Lite | as above | batched |
| Image | Imagen 4 Fast | $0.02 per image | INR 1.76 |
| Thumbnail | Imagen 4 Fast or Imagen 4 | $0.02 / $0.04 | INR 1.76 / 3.52 |
| Video, budget tier | Veo 3.1 Lite, video only, 1080p | $0.05 per unit | INR 4.40. 720p is $0.03 / INR 2.64 |
| Voiceover | Google Cloud Text to Speech | separate pricing page, unread | estimate INR 0.75 per 30s clip |
| Music | Free licensed library | 0 | licence recorded per track (FR-VD-08) |
| Moderation | Free tier endpoint, text + image + sampled frames | 0 | |

**Do not use:** Veo 3.1 (premium, INR 17.60), Veo 2 (INR 44.00). Veo 3.1 Lite only.

### Cost per action (verified September 2026)

| Action | Cost |
|---|---|
| Prompt compile | INR 0.09 |
| Caption set, five platforms | INR 0.11 |
| Hook and title set | INR 0.08 |
| Script, English | INR 0.92 |
| Image, standard | INR 1.76 |
| Thumbnail set, three variants | INR 5.28 |
| Voiceover, 30s | ~INR 0.75 (unverified) |
| Render compute, 24s composite | ~INR 0.88 (estimated, replace with measurement) |
| Video, per unit 1080p | INR 4.40 |

**Composite:** one image post INR 1.96. One 24 second reel at 1080p INR 114, at 720p INR 71. Reel to image post ratio is **58 to 1**, not 48 to 1. Use the corrected figure in any external material.

### Build budget

| Variant | On credit | Cash | Weeks |
|---|---|---|---|
| Full video 1080p | INR 19,200 | INR 1,500 | 8 |
| Full video 720p | INR 16,400 | INR 1,500 | 8 |
| Storyboard previews only | INR 9,400 | INR 1,500 | 6.5 |
| No video | INR 8,000 | INR 1,500 | 6 |

Cash is a domain name in every variant. Credit ceiling is INR 26,000 with a 90 day expiry clock, which binds before the balance does.

### Spend discipline

- Tune at 8 units, single scene, budget tier. One clip is ~INR 35 at 1080p or ~INR 21 at 720p.
- Inspect the compiled prompt as text before rendering. Most poor early video output is a poor compiled prompt.
- Cap render attempts per template at 20, then decide.
- Set a billing budget with an alert at 70 percent.
- Set maximum output tokens per generator. Output costs 6x input on Flash-Lite and 5x on Haiku.
- Use batch mode for the evaluation set. Half the standard rate and it is not latency sensitive.
- Leave the second founder trial unopened. It is worth more in week 5 than in week 1.

---

## 7. Credit and metering config

Credit anchor: **1 credit = INR 0.50**. Costs live in configuration, not code (FR-BL-01).

| Action | Credits | Retail | Provider cost | Markup |
|---|---|---|---|---|
| Caption set | 1 | INR 0.50 | INR 0.11 | 4.5x |
| Hook and title set | 1 | INR 0.50 | INR 0.08 | 6.3x |
| Script | 6 | INR 3.00 | INR 0.92 | 3.3x |
| Image, standard | 15 | INR 7.50 | INR 1.76 | 4.3x |
| Thumbnail set | 36 | INR 18.00 | INR 5.28 | 3.4x |
| Prompt compile | 0 | absorbed | INR 0.09 | not metered (FR-PO-14) |
| Video | per second of rendered output | | | held on requested duration, settled on delivered |

Two currencies, never convertible: **credits** (text, image, thumbnail) and **video seconds** (scarce, visible, counted). Both move only through `credit_ledger` entries tagged with their currency, and balance helpers always take the currency, so the two are never summed together.

For the demo: credits granted by seed script at plausible plan levels so metering matches the plan model rather than an arbitrary number. Two enforcement controls are kept because they are nearly free: a per workspace hard seconds cap, and a per generator maximum output token setting. Everything else in the production quota architecture is out.

---

## 8. Data model (proposed, derive migrations from this)

```
workspaces            id, name, timezone, credit_balance, video_seconds_balance, video_seconds_cap
                      -- balances cache SUM(credit_ledger) per currency, changed in the same txn
users                 id, email, ...                                                  [catalog]
memberships           workspace_id, user_id, role ('owner' | 'editor')

workspace_profiles    id, workspace_id, version, content_types[], platforms[], team_shape,
                      goal_90d, cadence, pillars[], tone, language, prohibited_words[], created_at
brand_kits            id, workspace_id, version, logo_url, colors[3], typography, tagline

templates             id, slug, output_type, current_version                          [catalog]
template_versions     id, template_id, version, aspect_ratio, model_tier,             [catalog]
                      compiler_profile_ref, style_params jsonb, post_processing jsonb, cost_band,
                      video_defaults jsonb (duration, scene_count, motion, voiceover, caption_style),
                      created_at   -- immutable; editing a template adds a version
template_previews     template_version_id, media_url, is_real_output (must be true)   [catalog]

compiler_profiles     id, output_type, version, config jsonb   -- versioned, no deploy [catalog]
metering_rates        id, version, rates jsonb, effective_from  -- FR-BL-01           [catalog]
music_tracks          id, title, storage_key, licence jsonb     -- FR-VD-08           [catalog]
compiled_prompts      id, workspace_id, job_id, parent_id, text, intent_text, template_id,
                      template_version, profile_version, brand_kit_version,
                      compiler_profile_version, user_edited bool, fallback_used bool, created_at

jobs                  id, workspace_id, job_class ('inference'|'render'|'publish'), generator_key,
                      status ('QUEUED'|'RUNNING'|'MODERATING'|'COMPLETE'|'BLOCKED'|'FAILED'|'CANCELLED'),
                      credits_held, credits_settled, video_seconds_held, video_seconds_settled,
                      input jsonb, error jsonb, created_at, updated_at
credit_ledger         id, workspace_id, job_id -> jobs, currency ('credits'|'video_seconds'),
                      delta, reason ('hold'|'settle'|'refund'|'grant'), created_at
                      -- unique (job_id, currency, reason) where reason in ('hold','settle','refund')
                      -- settle writes +(held - actual), so the net is the actual charge

outputs               id, workspace_id, job_id, kind, storage_key, metadata jsonb,
                      compiled_prompt_id, template_id, brand_kit_version, parent_output_id
video_scenes          id, workspace_id, output_id, index, clip_url, duration_s, prompt, regenerated_count
renditions            id, workspace_id, output_id, platform, spec, storage_key   -- derived once, cached

social_accounts       id, workspace_id, platform, external_id, scopes[], token_ciphertext,
                      token_expires_at, health
publications          id, workspace_id, scheduled_at, timezone, source_output_id, body jsonb
post_targets          id, workspace_id, publication_id, social_account_id, status,
                      body jsonb, rendition_id, platform_post_id,
                      attempt_count, last_error, claimed_at
slots                 id, workspace_id, recurrence_rule, pillar, platform, time_of_day

moderation_events     id, workspace_id, subject_type, subject_id, verdict, category, created_at
cost_telemetry        job_id, workspace_id, action_class, provider, realised_cost_inr, tokens_in, tokens_out
```

Notes:
- `workspace_id` is on every table above except those marked `[catalog]`. Catalog tables hold shared reference data, are read through `db.catalog.*`, and are written only by seed. `users` belongs to many workspaces through `memberships`. It is an identity table: with the session and login token tables added in WP4 it is written only by the auth layer, and sign in is limited to addresses the seed created, so nobody outside the team can create an account (A11).
- Status on `post_targets`, never an aggregate status on `publications`. Parent state is derived.
- `publications.body` is the shared source. Each `post_targets` row carries its own per platform body and rendition.
- `post_targets.status` includes `needs_verification` for a target claimed with no post id after a crash (invariant 9).
- `outputs.parent_output_id` supports any output becoming another generator's input (FR-GN-10).
- `compiled_prompts.parent_id` links a user edit to the prompt it was edited from.
- Job status values match `JobStatus` in `packages/contracts`.
- From WP3 on, the migrations in `packages/db/migrations` are authoritative. Additions beyond the list above: `post_targets.prepared_ref` (platform draft id, so polling survives a restart) and `post_targets.publish_started_at` (set just before the irreversible call, so a crash before it is safe to retry and a crash after it goes to `needs_verification`), `post_targets.published_at`, `jobs.correlation_id`, `compiler_profiles.key`, `social_accounts.display_name`.
- Enforced in the database, not only in code: ledger append only (trigger), ledger entry signs and once per job, non negative balances, previews must be real output, a published target must hold a post id, and compiled prompt lineage must point at template, profile and brand kit versions that exist.

---

## 9. Contracts

One integration contract, agreed in week 2 as TypeScript types in a shared package. Dev B builds Studio against it while Dev A implements behind it.

```ts
// packages/contracts/src/generator.ts

export type OutputType =
  | 'script' | 'hook' | 'caption' | 'image' | 'thumbnail' | 'video';

export interface CanonicalRequest {
  workspaceId: string;
  intentText: string;
  templateId: string;
  templateVersion: number;
  outputType: OutputType;
  targetPlatform: 'instagram' | 'linkedin' | null;
  profileVersion: number;
  brandKitVersion: number;
  params?: Record<string, unknown>;   // duration, sceneCount, aspect, voice
}

export interface CompiledPrompt {
  id: string;
  text: string;
  lineage: {
    intentText: string;
    templateVersion: number;
    profileVersion: number;
    brandKitVersion: number;
    compilerProfileVersion: number;
  };
  fallbackUsed: boolean;
  userEdited: boolean;
}

export interface CreditEstimate {
  credits: number;
  videoSeconds?: number;
  breakdown: Array<{ label: string; credits: number }>;
}

export type JobStatus =
  | 'QUEUED' | 'RUNNING' | 'MODERATING'
  | 'COMPLETE' | 'BLOCKED' | 'FAILED' | 'CANCELLED';

export interface GeneratorDefinition<TInput> {
  key: string;
  outputType: OutputType;
  jobClass: 'inference' | 'render';
  inputSchema: ZodType<TInput>;
  compilerProfile: string;
  providerAdapter: string;
  estimate(input: TInput, rates: MeteringRates): CreditEstimate;  // rates from metering_rates (FR-BL-01)
}

export interface GeneratorOutput {
  jobId: string;
  status: JobStatus;
  outputs: Array<{ kind: OutputType; storageKey: string; metadata: unknown }>;
  compiledPromptId: string;
  error?: { code: string; message: string; category?: string };
}
```

Adding a generator must not require changes to API routing (FR-GN-02).

The block above is the core. `packages/contracts` holds the full set as built in WP2: these types, the adapter interfaces (text, image, video, voice, moderation, publisher), the four failure categories from section 14, and `AdapterError`, the only error type that crosses the adapter boundary. `estimate` takes the versioned rates as an argument so no generator hardcodes a price.

---

## 10. Repo layout

```
apps/
  web/              Next.js app, API routes, server components
  worker/           BullMQ processors: inference, render, publish (one process, three classes)
packages/
  contracts/        shared TS types (section 9). The only cross stream dependency
  orchestration/    assembly, rewrite pass, enforcement, artifact persistence
  adapters/
    text/           gemini-flash-lite, haiku
    image/          imagen
    video/          veo-lite, <stubbed second provider>
    voice/          google-tts
    moderation/
    publishers/     instagram, linkedin
  db/               schema, migrations, scoped query helpers
  ui/               design system
infra/
  render-box/       ffmpeg Dockerfile, font set, systemd unit
  seed/             demo workspaces, templates, credit grants
```

---

## 11. Build sequence

Ordering principle is inverted from the production plan: long lead technical unknowns first, because the risk here is not billing error, it is discovering in week 6 that ffmpeg cannot composite captions cleanly over generated video.

**Streams:** Dev A owns providers, jobs, money and irreversible actions. Dev B owns everything the user touches plus prompt and template quality.

### Week 1: Foundation and spikes

| Task | Owner |
|---|---|
| Publishing developer mode spike, both platforms, day one | A |
| ffmpeg caption spike at 9:16, fix the font stack (specify Devanagari coverage even though unused) | A |
| Generate one 8 unit Veo 3.1 Lite clip and read the billing line | A |
| Compare Veo 3.1 Lite 720p vs 1080p on the same prompt | A |
| Provider accounts with hard prepaid caps, billing alert at 70 percent | A |
| Repo, shared types package, environments | A |
| Render box provisioned (small always on instance, ffmpeg, fonts) | A |
| Paid database and worker provisioned. No free tiers | A |
| Design system and app shell: Home, Studio, Calendar, Brand, Accounts, Insights, Settings | B |
| Auth, workspace, brand kit data model. `workspace_id` from the first migration | B |
| Buy the domain. Fix the demo date and work backwards | both |
| Publish the first real posts from demo accounts (Insights needs history by week 8) | both |

**Exit:** both spikes answered in writing. A user can sign in and land on an empty shell.

### Weeks 2 to 3: Orchestration and job model

| Task | Owner |
|---|---|
| Job engine with the transaction boundary from section 4 | A |
| Credit ledger: hold, settle, refund, grant. Balance derived | A |
| Generator registry and contract published | A + B |
| Orchestration: deterministic assembly (template scaffold, profile, brand kit, platform constraints) | A |
| Orchestration: rewrite pass, 1500ms budget, deterministic fallback path built now | A |
| Compiled prompt artifact persistence with full lineage | A |
| Single language path with the routing seam left in place (selected through the interface, not hardcoded) | A |
| Moderation pre check on the compiled prompt, text only. A blocked prompt never creates a job or a hold | A |
| Read the Google Cloud TTS pricing page, pick a voice tier | A |
| Onboarding flow and versioned workspace profile. One question per screen, each answer visibly configuring something | B |
| Compiled prompt disclosure, collapsed by default, viewable and editable | B |
| Studio shell with cost shown before submit, streamed output, navigable away. Streamed text stays in a checking state, with copy, edit and schedule locked, until moderation passes | B |

**Exit:** a user types plain intent, sees the compiled prompt, edits it, dispatches it, and has credits held and settled correctly.

### Week 4: Text, image and thumbnail

| Task | Owner |
|---|---|
| Image and thumbnail adapters. Aspect ratio driven by target platform, never asked | A |
| Moderation: post check on text and image output, refund on block with category stated. The text pre check is already live from week 3 | A |
| Script, hook, caption generation. Per platform caption variants from one idea | B |
| Text compositing layer (canvas or SVG over generated images) | B |
| Template gallery, 8 to 12 built, curated down later. Cost band shown before selection | B |
| Prompt and compiler profile tuning, named task. Run the 20 intent evaluation set against the raw control | B |

**Exit:** a script, caption set and thumbnail generated with brand kit applied, and a measured edit rate difference against the raw control.

### Weeks 5 to 6: Video

| Task | Owner |
|---|---|
| Video adapter with a stubbed second provider | A |
| Scene model and sequencing, up to 3 scenes at 8 seconds | A |
| Voiceover, English | A |
| Caption generation from script, composited (never transcribed) | A + B |
| Render worker: ffmpeg compositing, music, brand kit. Licence recorded per track | A |
| Preview then commit flow. The preview must be genuinely cheap, storyboard stills only | B |
| Per second cost display, live updating as duration and scene count change | B |
| Video templates with real rendered previews, muted and looping | B |

**Exit:** a three scene reel with voiceover, burned in captions, music and brand kit renders end to end, is metered per second, and refunds in full on an induced failure.

### Week 7: Publishing, Calendar and Composer

| Task | Owner |
|---|---|
| OAuth and envelope encrypted token storage | A |
| Instagram adapter: container creation and status polling | A |
| LinkedIn adapter: asset registration before upload | A |
| Claim before call idempotency | A |
| Scheduler with boot time sweep. Postgres source of truth | A |
| Rendition cache per platform spec | A |
| Composer with per platform previews and inline validation while editing | B |
| Calendar week view with per platform status chips. Video targets show render state | B |
| Sync centre: in flight and recent attempts, platform errors verbatim | B |

**Exit:** a generated reel and a generated image post scheduled and published to two real accounts, with per target status visible throughout.

### Week 8: Demo assembly

Carries no new capability by design. Protect it.

| Task | Owner |
|---|---|
| Insights, on demand fetch against whatever the connected accounts have | B |
| Seeded demo workspaces (section 15) | A |
| Template curation and final prompt tuning. Retire weak templates | B |
| Empty and loading states across all screens. Never a spinner over a whole screen | B |
| Demo runbook written | A + B |
| Three dry runs on the real environment, the third with someone outside the team driving | A + B |
| Fallback recording of the full loop, edited and timed | B |

**Exit:** the full loop runs end to end twice consecutively without intervention, and a recorded version exists that does not depend on the network in the room.

---

## 12. Cut path and checkpoints

**Cut in this order only if weeks are lost. Decide at the week 3 re baseline, not by compressing week 8.**

| Cut | Saves | What the demo loses |
|---|---|---|
| Video reduced to a single scene, no sequencing | 1.5 weeks | An 8 second clip instead of a 24 second story |
| One publishing platform instead of two | 0.5 weeks | The fan out story. Cut this last |
| Calendar reduced to a scheduled list view | 0.5 weeks | Habit, which is the retention argument |
| Insights removed | 0.5 weeks | The loop stops being a loop |

**Never cut:** the orchestration engine, the compiled prompt disclosure, the template previews. Without them this is a scheduling tool with a generate button.

| Checkpoint | Decision |
|---|---|
| End week 1 | Both spikes answered. If developer mode publishing fails, confirm the stubbed adapter fallback now and adjust what the demo claims |
| End week 3 | Re baseline against actual velocity. Invariants 1 to 8, 10 and 11 implemented and tested, not planned. 9, 12, 13 and 14 have schema and seams in place and are confirmed in the week each is built. All 14 confirmed in the week 8 dry runs |
| End week 4 | First evaluation set run. If lift against the raw control is not visible, that is a product finding worth more than the demo |
| End week 6 | Video renders end to end or it does not. If not, drop to image and thumbnail with storyboard previews only |

---

## 13. Screens for the demo

Reduced destination set: **Home, Studio, Calendar, Brand, Accounts, Insights, Settings**. Composer is a full screen layer entered from Studio or Calendar, never a top level destination.

| ID | Screen | Job | Key elements |
|---|---|---|---|
| S-01 | Sign in | Get in | Email. No card, no plan selection |
| S-02 | Workspace setup | Establish the tenant | Name, timezone, primary goal |
| S-03 | Connect account | Get one account connected | OAuth, capability limits stated honestly, skip allowed |
| S-04 | Home | Show what needs attention | Next 7 days, account health, credit balance, video seconds, empty slots |
| S-07 | Calendar week view | Maintain the schedule | Slots, per platform status chips, render state, empty slot as primary CTA |
| S-10 | Studio: script | Generate | Topic input, cost before submit, streamed output |
| S-11 | Studio: captions | Per platform variants | One idea in, variants out, live length indicators |
| S-12 | Studio: thumbnail | Generate creative | Prompt, aspect ratio, brand kit, editable text layer |
| S-13 | Composer | Finalise and schedule | Per platform preview tabs, inline validation, target selector, time picker |
| S-17 | Brand: profile | Correct how output sounds | Editable structured fields, version history |
| S-18 | Brand: kit | Visual identity | Logo, 3 colours, typography, tagline |
| S-19 | Accounts | Keep connections working | Per account health, scopes, capability limits stated |
| S-20 | Sync centre | See what is publishing | In flight and recent attempts, platform error verbatim |
| S-21 | Insights | Learn what worked | Ranking against own baseline. Thin and real |
| PROMPT | Compiled prompt disclosure | Show the engine | Collapsed by default, viewable, editable. Designed, not a debug panel |

**Empty and loading rule across all screens:** never a spinner over an entire screen. Render the frame, then fill it. Cards resolve independently.

**Credit experience:** cost shown before submission, balance always visible in the header, never a partial charge, full refund on failure or moderation block with the ledger entry visible.

---

## 14. State machines

### Generation job

| State | Meaning | Credit position |
|---|---|---|
| QUEUED | Hold committed, job enqueued | Held |
| RUNNING | Provider call in progress | Held |
| MODERATING | Output produced and visible in a checking state, policy check running. Copy, edit and schedule stay locked | Held |
| COMPLETE | Output available | Settled against actual cost |
| BLOCKED | Failed moderation, not released. Any streamed text is replaced by the category and the refund entry | Refunded in full |
| FAILED | Provider or system error after retries | Refunded in full |
| CANCELLED | User cancelled before dispatch | Refunded in full |

### Post target

Status lives on the target, never on the parent. Parent state is derived: all published, partially published, or all failed. Partial publish is a normal outcome, not an error.

Error classification, each with a distinct handling path: **retriable** (exponential backoff, bounded attempts, notify only when exhausted), **reauthorisation required**, **terminal** (policy rejection, never retried, retrying risks application suspension), **quota exhausted** (requeue into the next window without consuming an attempt).

A target found claimed with no platform post id after a crash is **needs verification**: shown in the Sync centre, confirmed against the account or by hand, never retried automatically.

---

## 15. Demo runbook and data

### Runbook, sequenced for investors (10 to 12 minutes)

| # | Step | Time | Proves |
|---|---|---|---|
| 1 | Open on a populated workspace with a filled calendar | 0.5 min | It is a product, not a prototype with one path |
| 2 | Type plain underspecified intent. Open the compiled prompt disclosure and read part aloud | 2 min | The orchestration engine. Slow down here |
| 3 | Generate the caption set across both platforms and a thumbnail. Point at the cost shown before submit | 2 min | Per platform adaptation, and that the team meters its own costs |
| 4 | Open the storyboard preview for a reel, then commit the render | 1.5 min | Cost control ahead of the expensive action. Leave it running |
| 5 | Show the finished reel, pre rendered | 1 min | The render pipeline |
| 6 | Schedule to Instagram and LinkedIn. Watch the Sync centre | 2 min | Fan out with independent per target status |
| 7 | Open Insights on a post published two weeks earlier | 1.5 min | The loop closing |
| 8 | State the orchestration lift number from the evaluation set | 1 min | Converts the claim in step 2 into a measurement |

Step 8 is the strongest moment and it is a sentence, not a screen. It is the last thing to cut.
Held in reserve, on request only: onboarding, moderation block, raw mode comparison.

### Seed data

- 2 to 5 workspaces, each with completed profile, brand kit, and 4 to 6 weeks of calendar history.
- At least 3 posts genuinely published 1 to 2 weeks before the demo, so Insights has real numbers.
- A library of prior outputs so Studio, including its Library tab, opens populated.
- One workspace deliberately near empty, to show onboarding without resetting anything.
- Credit balances granted at plausible plan levels.

### Failure contingencies

| Failure | Contingency |
|---|---|
| Render too slow to watch live | Never render live. Commit at step 4, return at step 5 |
| Provider outage mid demo | Deterministic fallback handles a slow rewrite pass. Hard failure means the recording |
| Network in the room | Recorded fallback, on the machine, not streamed |
| Platform rejects the publish | Show the Sync centre error verbatim. Rehearse narrating it |
| Poor output on an unrehearsed prompt | Do not take arbitrary prompts unless the evaluation set says templates hold up. Offer within a template, never raw mode |

### What the demo must not claim

- Approvals are not held. Publishing is developer mode against team controlled accounts. Say so.
- Nothing has been tested at scale. The reliability engineering is deliberately not built.
- Analytics are thin and real, never thin and simulated. Never fabricate a number in Insights.

---

## 16. Demo debt register

**Cheap to reverse:** no checkout (1 week), one worker process (2 days), boot time sweep instead of reconciler (1 day), on demand analytics (1 week), no caching (3 days), two platforms (2 to 3 weeks plus approvals), no token refresh worker (3 days).

**Load bearing, already covered in section 4.** Confirm them on the schedule in the week 3 checkpoint (section 12).

---

## 17. Open items to verify before hardcoding

1. **The Veo unit.** The pricing table quotes a price per one count and does not define the unit. Settle it in week 1 by generating one 8 second clip and reading the billing line. A charge of $0.24 confirms per second. A charge of $0.03 means the unit is a whole video and every video figure falls by ~8x.
2. **Storage and hosting vs the credit.** The architecture specifies Vercel and Cloudflare R2, but the costing assumes every line draws on the Google Cloud trial credit. Vercel and R2 do not. Either move storage to GCS and accept egress pricing, or carry them as cash lines. Decide in week 1.
3. **Google Cloud TTS rate.** The only figure in the cost model not taken from a published table. Read the page and pick a voice tier in week 2, before video templates are designed around a voice.
4. **Render compute at INR 0.88 per composite.** Estimated, never measured. Replace with a measurement once the render worker exists.
5. **Exchange rate.** 88 INR per USD throughout the current docs. An earlier working figure of 94 appears elsewhere. Pick one and make every rupee figure move with it.
6. **Plan pricing.** Cost Strategy v0.1 carries Free / Creator INR 999 / Studio INR 2,999 / Agency INR 7,999. A later working set of Free / 499 / 1,499 / 4,999 also exists. Confirm which is current before either reaches external material.
7. **Publishing pair.** This plan is built for Instagram plus LinkedIn. A later note proposes X plus LinkedIn with web intent publishing for the free tier. If that supersedes, the week 1 spike, both adapters and the week 7 plan change with it.
8. **Corrected ratios for external material.** Prompt compile is INR 0.09, not INR 0.03. Image post is INR 1.96, not INR 2.34. Reel to image ratio is 58 to 1, not 48 to 1.
9. Single provider dependency: FR-VD-17 requires two video providers behind one adapter and the credit expires. Wire the second adapter even if it is never called.

---

## 18. Working conventions for Claude Code

- TypeScript everywhere. Shared types in `packages/contracts` are the only cross stream dependency.
- Every database query goes through a workspace scoped helper. No raw unscoped queries.
- Provider SDK types stay inside `packages/adapters`. Nothing provider shaped crosses that boundary.
- Compiler profiles and credit costs live in versioned configuration, changeable without a deploy.
- Every job writes a `cost_telemetry` row on completion. This is painful to backfill.
- Correlation id spans request, compile, job, render and provider call.
- No secrets in source control. Social tokens under envelope encryption with the key outside the database.
- When a task would violate anything in section 4, stop and raise it rather than working around it.
- When a provider rate, platform quota or API shape matters to a decision, check the vendor's own page on the day. Comparison sites disagreed by up to 15x on identical models, which is what caused every correction in item 8 above.

---

## 19. Source document index

| Document | What to read it for |
|---|---|
| BRD v0.3 | Functional requirements by FR id, non functional requirements, platform integration matrix, risks, open questions Q1 to Q16 |
| AI Model and Cost Strategy v0.1 | Model stack and routing, unit economics, markup policy, plan and credit design, quota architecture, cost leaks |
| Demo Build Implementation Plan v0.3 | This build. Scope baseline, week plan, demo runbook, debt register, the line |
| Demo Costing v0.3 | Verified provider rates, build totals, credit coverage, traps, week one checklist |
| Solution and User Flows v0.1 | Screen inventory S-01 to S-25, seven user journeys, feature behaviour, state models, empty and error states, notifications |
| Feature Matrix (India) | Module by module scope with phase tags, China to India mapping, India specific constraints (DLT/TRAI, DPDP, IT Rules, ASCI, GST/OIDAR) |
| Implementation Plan (24 week) | Production architecture, runtime flow, phase detail, testing strategy. Requires reissue against BRD v0.3 |
