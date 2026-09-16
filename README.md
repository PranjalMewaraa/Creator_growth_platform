# Creator Growth Platform

Investor demo build. Read [plan.md](plan.md) for what and why, then [implementation-plan.md](implementation-plan.md) for how and in what order.

## Setup

Needs Node 24, pnpm (through corepack), a Postgres (Neon, or docker locally) and Redis for the worker.

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

Check the queue end to end with `pnpm --filter @cgp/worker enqueue:noop render` while `pnpm dev` runs. The worker logs `noop job processed`.

Provider calls default to fakes (`PROVIDERS=fake`). Real calls spend trial credit, so switch only when you mean to.

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

| Path                 | Holds                                                                     |
| -------------------- | ------------------------------------------------------------------------- |
| `apps/web`           | Next.js app and API routes                                                |
| `apps/worker`        | BullMQ worker, one process running the inference, render, publish queues  |
| `packages/contracts` | Shared types. The only cross stream dependency                            |
| `packages/config`    | Env schema, logger with correlation id                                    |
| `packages/db`        | Schema, migrations, `scoped()` and `catalog()` access, auth adapter, seed |
| `packages/ui`        | Design system primitives: button, card, empty state, form, stat           |
| `tooling`            | Repo level tests, such as the import boundary checks                      |

Lint enforces two boundaries from the plan: database drivers only inside `packages/db`, provider SDKs only inside `packages/adapters`.

## Database

Outside `packages/db`, code gets an opaque `Database` and reaches rows only through `scoped(db, workspaceId)` for tenant tables or `catalog(db)` for read only reference tables. Change the schema in `packages/db/src/schema`, then run `pnpm db:generate` and commit the SQL it writes to `packages/db/migrations`.

Database tests run on PGlite, an in-memory Postgres, so they need no database of their own and never touch `DATABASE_URL`. Tests of concurrent writers need a real Postgres.

Migrations that change a column other tables reference may need hand editing: see the note at the top of `packages/db/migrations/0002_identity.sql`.
