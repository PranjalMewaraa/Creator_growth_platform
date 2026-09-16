# Creator Growth Platform

Investor demo build. Read [plan.md](plan.md) for what and why, then [implementation-plan.md](implementation-plan.md) for how and in what order.

## Setup

Needs Node 24, pnpm (through corepack) and Docker.

```bash
corepack enable        # once per machine; on Windows run from an admin shell
pnpm install
cp .env.example .env
pnpm infra:up          # Postgres and Redis in docker
pnpm db:migrate        # apply migrations
pnpm db:seed           # demo workspaces, metering rates, credit grants
pnpm dev               # web on http://localhost:3000, worker alongside
```

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

| Path                 | Holds                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `apps/web`           | Next.js app and API routes                                               |
| `apps/worker`        | BullMQ worker, one process running the inference, render, publish queues |
| `packages/contracts` | Shared types. The only cross stream dependency                           |
| `packages/config`    | Env schema, logger with correlation id                                   |
| `packages/db`        | Schema, migrations, `scoped()` and `catalog()` access, seed              |
| `tooling`            | Repo level tests, such as the import boundary checks                     |

Lint enforces two boundaries from the plan: database drivers only inside `packages/db`, provider SDKs only inside `packages/adapters`.

## Database

Outside `packages/db`, code gets an opaque `Database` and reaches rows only through `scoped(db, workspaceId)` for tenant tables or `catalog(db)` for read only reference tables. Change the schema in `packages/db/src/schema`, then run `pnpm db:generate` and commit the SQL it writes to `packages/db/migrations`.

Database tests run on PGlite, an in-memory Postgres, so they need no docker. Tests of concurrent writers need the docker Postgres.
