# Deployment guide

Two environments: **test**, built entirely on free tiers so it costs nothing to keep up, and
**production**, built on paid tiers of the same services so nothing changes shape between the
two. Everything here is derived from the code as it is: the environment variables are the ones
`packages/config/src/env.ts` and `apps/web/src/server/runtime.ts` actually parse, and the
commands are the ones in the package scripts.

---

## 1. What has to run

| Process | Package | Start | Needs |
|---|---|---|---|
| **Web** | `@cgp/web` | `next start --port 3000` | Postgres, Redis, the env below |
| **Worker** | `@cgp/worker` | `tsx src/main.ts` | Postgres, Redis, **ffmpeg** (libx264, AAC, libass), the env below |

The worker is a long-running process: it consumes the BullMQ queues, runs the scheduler tick
every 15 seconds, and sweeps for orphaned jobs on boot. It cannot be a serverless function and
it cannot be allowed to sleep, or scheduled posts simply do not go out.

Shared services:

| Service | Used for | Required? |
|---|---|---|
| **Postgres** | Everything that is true (invariant 2) | Always |
| **Redis** | Queue transport and the job event stream, never the record | Always |
| **Object storage (GCS)** | Uploads, generated images, clips, reels | **Whenever web and worker are separate processes.** Without `GCS_BUCKET` the store is in memory, which only works when both run in one process on one machine |
| **Vertex AI** | Text, image, video, voice, moderation | Only with `PROVIDERS=real` / `MODERATION=google` |
| **Email** | Sign in links | Required for anyone other than you to sign in |

### Environment variables

Every process reads these (`packages/config/src/env.ts`):

| Variable | Test | Production | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | `production` | Both deployed environments are production builds |
| `LOG_LEVEL` | `info` | `info` | pino levels; JSON to stdout |
| `DATABASE_URL` | Neon free | Neon paid / Cloud SQL | Must include `?sslmode=require` for Neon |
| `REDIS_URL` | Upstash free (`rediss://`) | Upstash paid / Memorystore | TLS URLs work as-is; `maxRetriesPerRequest: null` is already set for BullMQ |
| `PROVIDERS` | `fake` first, `real` once GCP is wired | `real` | Real calls spend money |
| `MODERATION` | `fake` → `google` | `google` | `fake` allows everything except `FAKE_BLOCK` markers |
| `PUBLISHING` | `fake` | `real` | **Never `real` in test**: it posts to real accounts |
| `GCS_BUCKET` | a bucket in the free tier | a bucket | See the memory store warning above |
| `TOKEN_ENCRYPTION_KEY` | generated | generated, in Secret Manager | 32 bytes base64url; wraps platform tokens. Losing it means every account must reconnect |
| `GOOGLE_CLOUD_PROJECT` | your project | your project | Required when `PROVIDERS=real` |
| `FFMPEG_PATH` | `ffmpeg` | `ffmpeg` | Worker only. A name on PATH or an absolute path |
| `INSTAGRAM_CLIENT_ID` / `_SECRET` | optional | set | Without them the connect button says so |
| `LINKEDIN_CLIENT_ID` / `_SECRET` | optional | set | As above |

The web process additionally reads (`apps/web/src/server/runtime.ts`):

| Variable | Test | Production | Notes |
|---|---|---|---|
| `AUTH_SECRET` | generated | generated, in Secret Manager | ≥ 32 chars; signs sessions and links |
| `APP_URL` | `https://<project>.vercel.app` | `https://app.yourdomain` | Must match exactly; it is baked into magic links and OAuth redirects |
| `RESEND_API_KEY` | Resend free | Resend paid | Or `SMTP_URL` instead |
| `SMTP_URL` | — | — | Any relay, e.g. `smtps://user:pass@smtp.example:465` |
| `EMAIL_FROM` | optional with Resend | `Creator Growth Platform <hello@yourdomain>` | Required with SMTP |

Generate the secrets once per environment and never reuse them between the two:

```bash
node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
```

```bash
node -e "console.log('TOKEN_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64url'))"
```

### One-time database steps (both environments)

Migrations and the catalog seed run **from your machine or CI**, pointed at the environment's
`DATABASE_URL`. The catalog seed is not optional: templates, compiler profiles and metering
rates are catalog tables written only by the seed, and nothing can be priced or compiled until
they exist.

```bash
DATABASE_URL="postgres://…" pnpm db:migrate
```

```bash
DATABASE_URL="postgres://…" SEED_OWNER_EMAIL="you@yourdomain" pnpm db:seed
```

`SEED_OWNER_EMAIL` creates the first owner account and the demo workspace. Since WP51 anyone
can sign up, so after the first run this is only for the demo data. Re-running the seed is
safe; it is idempotent on the catalog.

---

## 2. Test environment — free tiers only

Target shape: **Vercel** (web) + **Koyeb** or **Railway** (worker) + **Neon** (Postgres) +
**Upstash** (Redis) + **Resend** (email) + optionally **GCS** and **Vertex** inside Google
Cloud's free credit. Monthly cost with `PROVIDERS=fake`: ₹0.

### 2.1 Neon (Postgres)

1. Create a project at neon.tech, region closest to your worker host (e.g. `ap-southeast-1`).
   Postgres 17.
2. Create a branch called `test` so the main branch can later become production.
3. Copy the **pooled** connection string for the app and the **direct** one for migrations.
   Both need `?sslmode=require`.
4. Free tier: 0.5 GB storage, autosuspends after 5 minutes idle. The first request after a
   suspend takes ~1 s; the worker's 15-second scheduler tick keeps it awake while the worker
   runs, which is fine on free compute hours (190 h/month) if you pause the worker when not
   demoing. This is the same `CONNECT_TIMEOUT` you have seen locally — it is the cold start.
5. Run the migrations and seed from your machine against the **direct** URL.

### 2.2 Upstash (Redis)

1. Create a database at upstash.com, same region, **TLS on**, eviction **off** (BullMQ keeps
   job state in Redis between steps; eviction would lose it).
2. Use the `rediss://default:…@….upstash.io:6379` URL as `REDIS_URL` for both processes.
3. Free tier: 500k commands/month. BullMQ's blocking reads count; with one worker and a
   15-second scheduler tick the idle cost is roughly 200k commands/month. Fine for a test
   environment that is not left running 24/7. If you exceed it the worker stalls rather than
   failing loudly — watch the Upstash dashboard the first week.

### 2.3 Resend (email)

1. Create an account at resend.com. The free tier is 3,000 emails/month, 100/day.
2. Without a verified domain you can only send to **your own address** from
   `onboarding@resend.dev`, which `EMAIL_FROM` falls back to. That is enough for you to sign
   in; it is not enough for a second tester.
3. To let anyone sign up, verify a domain (DNS: SPF, DKIM, the records Resend shows) and set
   `EMAIL_FROM="Creator Growth Platform <signin@yourdomain>"`.
4. Free alternative with no domain: any SMTP relay you already have, via `SMTP_URL`. For a
   Gmail account, create an app password and use
   `smtps://you@gmail.com:APP_PASSWORD@smtp.gmail.com:465` with `EMAIL_FROM` set to that
   address. Gmail caps this at ~500/day, which is more than a test environment will send.

### 2.4 Vercel (web)

The repository is a pnpm monorepo and the web app depends on workspace packages that ship
TypeScript source. Vercel handles this, with four settings that are easy to get wrong:

| Setting | Value |
|---|---|
| Framework | Next.js |
| **Root Directory** | `apps/web` — and tick **"Include source files outside of the Root Directory"** |
| Install Command | `pnpm install --frozen-lockfile` (runs at the repo root) |
| Build Command | `pnpm turbo run build --filter=@cgp/web` |
| Node.js version | **24** (the repo's `engines` requires it; pick it in Project → Settings → General) |
| Environment variable | `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel honours `packageManager: pnpm@12.4.1` |

Then add every web variable from §1 under **Environment Variables → Preview + Production**
(Vercel's "Production" here is your *test* environment; keep real production off Vercel's
Hobby plan, see §3). Set `APP_URL` to the `*.vercel.app` URL Vercel gives you — or a custom
domain — before the first sign in, because the first magic link will contain whatever it was.

Two things that behave differently on Vercel than on a server:

- **The job event stream** (`/api/w/…/jobs/…/events`) is a long-lived response over Redis
  pub/sub. On Hobby, functions are cut at the plan's duration limit (enable **Fluid Compute**
  in project settings to get the longest window). When the stream drops, the Studio keeps
  showing the job's status from Postgres and reconnects; nothing is lost, the ledger's live
  lines just arrive late. This is by design: Postgres is truth, Redis is transport.
- **Vertex credentials.** Google's SDKs read a service-account key from a file path in
  `GOOGLE_APPLICATION_CREDENTIALS`, and Vercel has no files. Stay on `PROVIDERS=fake` and
  `MODERATION=fake` on the web side of test until you need real compiles there; the worker,
  which does the expensive calls, runs where a file can exist (§2.5). When you do want real
  providers from Vercel, the supported route is Workload Identity Federation from Vercel's
  OIDC token, not a key in an env var.

Deploy: connect the GitHub repository, push to `main`, watch the build. Then:

```bash
curl -s https://<project>.vercel.app/api/health
```

should answer `{"ok":true,"service":"web","providers":"fake"}`.

### 2.5 The worker (Koyeb free, or Railway)

The worker needs ffmpeg, so it runs from the Dockerfile at `apps/worker/Dockerfile`, which
installs ffmpeg and fontconfig on `node:24-bookworm-slim` and starts `pnpm --filter @cgp/worker
start`. Any host that runs a Docker image as an always-on service works. Two with a free tier:

**Koyeb** (recommended: a permanent free "nano" instance, 512 MB, no sleep)

1. Create a service → GitHub → this repository, builder **Dockerfile**, path
   `apps/worker/Dockerfile`, build context `/` (the repo root; the Dockerfile copies the
   whole workspace).
2. Service type **Worker** (no public port). Instance: free nano. Region near Neon/Upstash.
3. Environment: every variable in §1's first table. `PROVIDERS=fake` to begin with.
4. For `PROVIDERS=real`: create a GCP service account with roles **Vertex AI User**,
   **Storage Object Admin** (your bucket only), **Cloud Natural Language** and **Cloud Vision**
   API users; download its JSON key; add it as a **secret file** mounted at
   `/secrets/gcp.json`; set `GOOGLE_APPLICATION_CREDENTIALS=/secrets/gcp.json` and
   `GOOGLE_CLOUD_PROJECT`.
5. 512 MB is tight for a reel render (ffmpeg + three clips in memory). Renders will work for
   8-second 720p clips; if the instance is OOM-killed on the reel step, that is the free tier,
   not a bug — the clips are already stored and paid for, only the joined reel is missing.

**Railway** (one-off $5 trial credit, then $5/month)

Same Dockerfile; set the service's root to `/` and Dockerfile path `apps/worker/Dockerfile`;
add variables; no port needed. Railway has no file mounts, so for Vertex use the base64 trick:
store the key as `GCP_KEY_B64` and start the container with
`sh -c 'echo "$GCP_KEY_B64" | base64 -d > /tmp/gcp.json && pnpm --filter @cgp/worker start'`
with `GOOGLE_APPLICATION_CREDENTIALS=/tmp/gcp.json`.

The worker logs `worker started` when it is consuming. If it logs Redis reconnects forever,
`REDIS_URL` is wrong or Upstash is out of commands.

### 2.6 Object storage (needed as soon as web and worker are apart)

With the web on Vercel and the worker elsewhere, an upload accepted by the web must be readable
by the worker, and a frame drawn by the worker must be visible on the web. The in-memory store
cannot do that. Set `GCS_BUCKET` on **both**:

1. In the GCP project, create a bucket (Standard, single region, uniform access, **public read**
   on objects — the product links to them directly). Google Cloud's always-free tier covers
   5 GB-months in US regions; outside the US it is pennies.
2. The web's service account (or, on Vercel without credentials, nothing) — note that the web
   **uploads** through the GCS adapter too, so uploads from the composer need credentials on
   the web side. Until Vercel has Workload Identity set up, the practical test-env rule is:
   generate in the Studio (worker writes to GCS), compose from the Studio's output (web only
   links), and skip direct uploads from the composer.

### 2.7 Google Cloud for real providers (optional in test)

Everything below fits Google Cloud's $300 new-account credit, and the worker's quota pacing
(two images a minute, one video submission a minute) was measured against exactly these
defaults.

1. Enable APIs: Vertex AI, Cloud Storage, Cloud Natural Language, Cloud Vision, Text-to-Speech.
2. Service account as in §2.5 step 4.
3. Set `PROVIDERS=real`, `MODERATION=google`, `GOOGLE_CLOUD_PROJECT` on the worker; keep
   `PUBLISHING=fake`.
4. Costs at the project's rates: ₹2.96 per image, ₹21.12 per 8-second 720p clip. A full
   storyboard-plus-reel is about ₹75. Credits in the product meter this; the ledger is the
   record.

### 2.8 Test environment checklist

```bash
curl -s https://<project>.vercel.app/api/health
```

- [ ] Health answers `ok:true`
- [ ] Sign in with your address: the link arrives (Resend dashboard shows it; or the log on the web host with no sender set)
- [ ] Sign up with a **second** address lands on "Create a workspace" (needs a verified domain or SMTP)
- [ ] First run card on Home shows 0 of 4
- [ ] Studio → Script with `PROVIDERS=fake` completes in seconds (proves Redis + worker)
- [ ] Composer → schedule a post 2 minutes out → Sync centre shows it published by the fake publisher (proves the dispatcher)
- [ ] With real providers: one storyboard; watch the work ledger narrate three frames and the quota wait on the third

---

## 3. Production

Same services, paid tiers, and three changes of principle: **no key files anywhere**
(workload identity), **secrets in a secret manager**, and **both processes in one region next
to the database**.

### 3.1 Topology

```
                     ┌────────────┐      ┌─────────────┐
   users ──HTTPS──▶  │  Web       │◀────▶│  Neon       │  Postgres (truth)
                     │  Cloud Run │      │  (or Cloud  │
                     └─────┬──────┘      │   SQL)      │
                           │ pub/sub     └─────────────┘
                     ┌─────▼──────┐      ┌─────────────┐
                     │  Redis     │◀────▶│  Worker     │  BullMQ, scheduler, ffmpeg
                     │  Upstash / │      │  Cloud Run  │
                     │  Memorystore│     │  (min 1)    │
                     └────────────┘      └──────┬──────┘
                                                │
                                   ┌────────────▼────────────┐
                                   │  GCS bucket · Vertex AI │
                                   └─────────────────────────┘
```

Recommended hosts:

| Piece | Choice | Why |
|---|---|---|
| Web | **Cloud Run** (or Vercel Pro) | Cloud Run gives the web the same workload identity as the worker, so Vertex and GCS need no keys. Vercel Pro is fine if you prefer it; then use Workload Identity Federation for Google |
| Worker | **Cloud Run service, `--min-instances=1`, `--no-cpu-throttling`, no ingress** | Always on, scales to 1, same identity. A GCE `e2-small` VM is the cheaper alternative if you would rather not run ffmpeg in a request-shaped container |
| Postgres | **Neon Launch** (PITR, autoscaling) or Cloud SQL | Neon's branching makes a prod→staging copy a one-liner |
| Redis | **Upstash Pro** or Memorystore | Memorystore if everything is in GCP; Upstash if the web is on Vercel |
| Storage | GCS, same project | — |
| Email | Resend paid, verified domain | — |
| Secrets | **Secret Manager**, mounted as env on Cloud Run | `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL`, `REDIS_URL`, `RESEND_API_KEY`, the OAuth secrets |

### 3.2 Build and deploy (Cloud Run)

Both images build from the repository root. The worker uses `apps/worker/Dockerfile`; the web
can use the same base with `pnpm --filter @cgp/web build` and `pnpm --filter @cgp/web start`
(a `apps/web/Dockerfile` following the same pattern is a ten-line change when you choose Cloud
Run for the web; ask and it will be added).

```bash
gcloud builds submit --tag asia-south1-docker.pkg.dev/$PROJECT/cgp/worker:$(git rev-parse --short HEAD) -f apps/worker/Dockerfile .
```

```bash
gcloud run deploy cgp-worker --image asia-south1-docker.pkg.dev/$PROJECT/cgp/worker:$SHA --region asia-south1 --no-allow-unauthenticated --ingress internal --min-instances 1 --max-instances 1 --no-cpu-throttling --memory 2Gi --cpu 2 --service-account cgp-worker@$PROJECT.iam.gserviceaccount.com --set-secrets DATABASE_URL=cgp-database-url:latest,REDIS_URL=cgp-redis-url:latest,TOKEN_ENCRYPTION_KEY=cgp-token-key:latest --set-env-vars NODE_ENV=production,PROVIDERS=real,MODERATION=google,PUBLISHING=real,GCS_BUCKET=cgp-prod-media,GOOGLE_CLOUD_PROJECT=$PROJECT
```

Notes on that command: **`--max-instances 1`** is deliberate. The scheduler dispatcher runs
in every worker instance; two instances would both tick, and while `dispatchDue` claims before
it sends (invariant 9), one worker is the configuration the system was built and tested with.
Scale the worker by concurrency inside the process, not by instances, until that is revisited.
**2 GiB** is the comfortable floor for a reel render.

IAM for the two service accounts:

| Account | Roles |
|---|---|
| `cgp-web` | `roles/aiplatform.user`, `roles/storage.objectAdmin` (bucket-scoped), `roles/secretmanager.secretAccessor` |
| `cgp-worker` | the above plus `roles/cloudtexttospeech.user` (via `roles/serviceusage.serviceUsageConsumer` + API enabled), Natural Language and Vision API users |

### 3.3 Before the first production deploy

1. **Database**: `pnpm db:migrate` against the production URL, then `pnpm db:seed` once for the
   catalog. From then on, migrations run in CI **before** the new image is rolled out; the
   schema is expanded first and contracted in a later release, never in the same one.
2. **`APP_URL`** is the final domain, with HTTPS, no trailing slash. Everything that leaves
   the system — magic links, OAuth redirects — embeds it.
3. **OAuth redirect URIs** registered with Meta and LinkedIn, exactly:
   `https://app.yourdomain/api/oauth/instagram/callback` and
   `https://app.yourdomain/api/oauth/linkedin/callback`. The state is signed with
   `AUTH_SECRET` and expires in 10 minutes.
4. **`PUBLISHING=real`** is the one switch that makes the product public. Turn it on last,
   after a dry run with `fake` in production has shown a post travelling composer → queue →
   sync centre.
5. **Backups**: Neon Launch has 7-day PITR; set it. The ledger is append-only, so a restore is a
   restore, not a reconciliation.
6. **Logs**: both processes write pino JSON to stdout; Cloud Logging indexes `level`,
   `jobId`, `correlationId`. Create two alerts: worker log silence > 5 minutes (it ticks every
   15 s), and any `needs_verification` post target (a publish that may or may not have gone
   out; nobody retries it on purpose).

### 3.4 Rollout and rollback

- Deploy the **worker first**, then the web. A new web talking to an old worker can enqueue a
  generator the worker does not know; the reverse cannot happen.
- Cloud Run keeps previous revisions: rollback is `gcloud run services update-traffic
  cgp-web --to-revisions PREVIOUS=100`. Because the schema only expands within a release, the
  previous image still runs against the new schema.
- Never roll back a migration that has been written to; add a forward one.

### 3.5 Production smoke test

- [ ] `/api/health` → `providers:"real"`
- [ ] Sign up with a fresh address from a phone, off your network
- [ ] First run: profile → brand kit → connect one real account (you will click Allow)
- [ ] One storyboard, one redraw of a frame, film it: three clips settle for 24 seconds, not 72
- [ ] Schedule a post to your own account five minutes out with `PUBLISHING=real`; see the permalink in the Sync centre
- [ ] Kill the worker mid-render and restart it: the boot sweep re-enqueues, the job finishes, nothing is charged twice

---

## 4. Monthly cost, roughly

| | Test | Production (small) |
|---|---|---|
| Postgres | Neon free, ₹0 | Neon Launch ~₹1,600 |
| Redis | Upstash free, ₹0 | Upstash Pro ~₹850 / Memorystore 1 GB ~₹2,900 |
| Web | Vercel Hobby, ₹0 | Cloud Run ~₹400–1,200 / Vercel Pro ₹1,700 |
| Worker | Koyeb nano, ₹0 | Cloud Run min-1, 2 vCPU/2 GiB ~₹4,000 |
| Storage | GCS free tier, ₹0 | ~₹200 per 100 GB |
| Email | Resend free, ₹0 | Resend ₹1,700 at 50k |
| Providers | ₹0 with `fake`; ~₹75 per real reel | Metered by the ledger; ₹75 per reel, ₹3 per image |

---

## 5. Local, for completeness

`docker compose up -d` starts Postgres 17 and Redis 8 on this machine; `.env.example` is the
template. Neon is the development database by decision, so `DATABASE_URL` points there and
only Redis comes from compose. `pnpm dev` runs both apps. The render step needs an ffmpeg with
libx264, AAC and libass on `PATH` or at `FFMPEG_PATH`.
