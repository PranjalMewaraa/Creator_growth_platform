# The render worker (docs/deployment.md §2.5, §3.2). Built from the repository root:
#
#   docker build -f apps/worker/Dockerfile -t cgp-worker .
#
# The worker needs ffmpeg with libx264, AAC and libass; Debian's package has all three, and
# fontconfig is what libass uses to find a font for burned-in captions. Everything else is the
# pnpm workspace as it is on a developer's machine: the packages ship TypeScript source and the
# worker runs it through tsx, so there is no build step to get wrong.

FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-noto-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# The pnpm the repository pins (package.json "packageManager"), via corepack.
RUN corepack enable

WORKDIR /app

# Manifests first, so a source change does not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/adapters/package.json packages/adapters/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/orchestration/package.json packages/orchestration/
COPY packages/ui/package.json packages/ui/
COPY tooling ./tooling

RUN pnpm install --frozen-lockfile --filter @cgp/worker...

COPY . .

ENV NODE_ENV=production
ENV FFMPEG_PATH=ffmpeg

# No port: the worker consumes queues. Hosts that insist on a health check can use the log
# line "worker started", which it writes once it is consuming.
CMD ["pnpm", "--filter", "@cgp/worker", "start"]
