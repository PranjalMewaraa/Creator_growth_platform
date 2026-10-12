# The web app (docs/deployment.md §3.2). Built from the repository root:
#
#   docker build -f apps/web/Dockerfile -t cgp-web .
#
# Same base and the same workspace layout as the worker's image, so the two never drift. The
# difference is one step: `next build` runs here, and it needs no secrets to do so, because the
# web parses its environment on first request rather than at import.
#
# The image keeps node_modules rather than using Next's standalone output: the workspace
# packages are transpiled from source and sharp, resvg and the provider SDKs are loaded as
# externals at runtime, which is the arrangement next.config.ts documents and the one that has
# been run. It is a larger image than it could be, and it is a known one.

FROM node:24-bookworm-slim

# ca-certificates for Neon, Upstash and Vertex over TLS; fontconfig because resvg looks for
# system fonts before falling back to the ones the repository ships.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates fontconfig \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/adapters/package.json packages/adapters/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/orchestration/package.json packages/orchestration/
COPY packages/ui/package.json packages/ui/
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile --filter @cgp/web...

COPY . .

# Telemetry off, and the build in production mode. No .env is present (see .dockerignore) and
# none is needed: runtime.ts parses the environment on first use.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm --filter @cgp/web build

# The start script listens on 3000. Cloud Run is told so with `--port 3000`; any other host
# maps whatever it likes onto it.
EXPOSE 3000
CMD ["pnpm", "--filter", "@cgp/web", "start"]
