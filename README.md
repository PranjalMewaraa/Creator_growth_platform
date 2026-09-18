# Creator Growth Platform

Investor demo build. Read [plan.md](plan.md) for what and why, then [implementation-plan.md](implementation-plan.md) for how and in what order.

## Setup

Needs Node 24, pnpm (through corepack), a Postgres (Neon, or docker locally) and Redis for the worker and the API routes.

```bash
corepack enable        # once per machine; on Windows run from an admin shell
pnpm install
cp .env.example .env   # then set DATABASE_URL and AUTH_SECRET
pnpm infra:up          # optional: Postgres and Redis in docker
pnpm db:migrate        # apply migrations
pnpm db:seed           # demo workspaces, metering rates, credit grants
pnpm dev               # web on http://localhost:3000, worker alongside
```

Sign in at http://localhost:3000 with `SEED_OWNER_EMAIL` (default `owner@example.com`). Only addresses the seed created can sign in. With no email sender configured, the sign in link is written to the web server log.

Check the job pipeline end to end while the worker runs: `pnpm --filter @cgp/worker enqueue:noop <workspace id> [inference|render|publish]` submits a free job through Postgres and the queue, and the worker logs `noop job processed` and `settled`. On start the worker re-enqueues any job a previous run left waiting and reports balance drift.

## API

Every route is under `/api/w/<workspace id>` and answers 404 to anyone who is not a member. Generators live in one registry, `packages/core/src/generators/definitions.ts`; adding one there needs no route change (FR-GN-02, checked by `tooling/generator-routing.test.ts`).

| Route                                | Does                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET generators`                     | The registered generators                                                                 |
| `POST generate/<generator>/estimate` | Prices a request against the metering rates in force. Holds nothing                       |
| `POST generate/<generator>/compile`  | Compiles plain intent into a prompt to read and edit first. Charges nothing               |
| `POST generate/<generator>`          | Compiles (or takes `compiledPromptId`), checks, holds, queues: 202, or 402, 404, 409, 422 |
| `GET prompts/<prompt id>`            | A compiled prompt with its lineage and resolved settings                                  |
| `POST prompts/<prompt id>/versions`  | A user edit, `{ "text": ... }`, as a new version of the prompt                            |
| `GET jobs/<job id>`                  | Job status from Postgres, the polling fallback                                            |
| `GET jobs/<job id>/events`           | Server sent events: `status` from Postgres, `delta` text relayed through Redis            |

The worker runs the text generators (script, hooks, captions). Image and video generators have no handler until weeks 4 to 6, so their jobs fail and are refunded in full. Compiler profiles are seeded catalog rows: to change one, edit it in `packages/db/src/seed-catalog.ts`, bump `COMPILER_PROFILE_VERSION` and run `pnpm db:seed`.

## Posting

Connect the demo accounts from the tokens in `.env` (until the OAuth flow exists), then use **New post** in the header:

```bash
pnpm --filter @cgp/worker accounts:import <workspace id>
```

Publishing has its own switch: `PUBLISHING=fake` (the default) pretends, `PUBLISHING=real` makes public posts. Uploads go to the GCS bucket in `GCS_BUCKET` and are publicly readable, because Instagram fetches images by URL. Instagram needs a JPEG between 4:5 and 1.91:1; LinkedIn takes text alone or with a JPEG or PNG. Tokens are stored encrypted with `TOKEN_ENCRYPTION_KEY` (32 bytes, base64url); losing that key means importing the accounts again.

Each account is its own post target with its own status. A target is claimed before the platform is called and its post id is written the moment it comes back (invariant 9); a target interrupted mid publish becomes `needs_verification` and is never retried automatically.

## Providers

Provider calls default to fakes (`PROVIDERS=fake`). Real calls spend trial credit, so switch only when you mean to. Real calls go through Vertex with application default credentials (`gcloud auth application-default login`) and `GOOGLE_CLOUD_PROJECT`. `pnpm --filter @cgp/adapters smoke:text [model key ...]` makes one tiny real call per text model. `CGP_LIVE_PROVIDERS=1 pnpm test` runs the text adapter contract tests against the real providers as well as the fakes.

Moderation is its own switch: `MODERATION=fake` (the default) or `google`, which needs the Cloud Natural Language and Vision APIs enabled on `GOOGLE_CLOUD_PROJECT`. Every dispatch records a verdict in `moderation_events`; if the service cannot answer, the dispatch is refused with a 503 and nothing is held.

Fakes return real files (PNG, WAV, an MP4 fixture) and take markers in their input: `FAKE_FAIL:<retriable|reauth|terminal|quota>` fails with that category, `FAKE_BLOCK:<category>` is flagged by fake moderation.

## Checks

The same commands CI runs:

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Layout

| Path                     | Holds                                                                     |
| ------------------------ | ------------------------------------------------------------------------- |
| `apps/web`               | Next.js app and API routes                                                |
| `apps/worker`            | BullMQ worker, one process running the inference, render, publish queues  |
| `packages/contracts`     | Shared types. The only cross stream dependency                            |
| `packages/config`        | Env schema, logger with correlation id                                    |
| `packages/db`            | Schema, migrations, `scoped()` and `catalog()` access, auth adapter, seed |
| `packages/ui`            | Design system primitives: button, card, empty state, form, stat           |
| `packages/core`          | Job engine and generator registry: credit holds, queues, job streams      |
| `packages/orchestration` | Prompt compiler: precedence, brief, rewrite pass, enforcement, edits      |
| `packages/adapters`      | Provider adapters and their fakes, model ids, error normalisation         |
| `tooling`                | Repo level tests, such as the import boundary checks                      |

Lint enforces two boundaries from the plan: database drivers only inside `packages/db`, provider SDKs only inside `packages/adapters`.

## Database

Outside `packages/db`, code gets an opaque `Database` and reaches rows only through `scoped(db, workspaceId)` for tenant tables or `catalog(db)` for read only reference tables. Change the schema in `packages/db/src/schema`, then run `pnpm db:generate` and commit the SQL it writes to `packages/db/migrations`.

Database tests run on PGlite, an in-memory Postgres, so they need no database of their own and never touch `DATABASE_URL`. Tests of concurrent writers need a real Postgres: set `TEST_DATABASE_URL` and they create a throwaway database there and drop it afterwards. The pipeline tests need Redis at `REDIS_URL` and use their own key prefix. Both skip themselves when their service is missing.

If API routes suddenly answer an HTML 404 in `pnpm dev` after a `pnpm build`, the production build and the dev server shared `apps/web/.next`: delete it and restart.

Migrations that change a column other tables reference may need hand editing: see the note at the top of `packages/db/migrations/0002_identity.sql`.
