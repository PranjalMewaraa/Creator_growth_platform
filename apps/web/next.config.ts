import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NextConfig } from 'next';

// The root .env, read here rather than through @cgp/config: this file is evaluated before the
// dev server starts, and importing a workspace package makes the toolchain transpile that
// package and its dependencies first, which measured at about 15 seconds of startup.
for (let dir = process.cwd(); ;) {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    if (existsSync(join(dir, '.env'))) process.loadEnvFile(join(dir, '.env'));
    // @cgp/core is transpiled (below), not external, so it is bundled into the server chunk —
    // which means its own `fontDir()` helper can no longer find itself by calling
    // `require.resolve('@cgp/core/package.json')`: Turbopack rewrites a bundled module's own
    // `require.resolve` into its internal module-id lookup, so that call returns a number, not
    // a path, and `dirname()` on it throws (caught live: "The 'path' argument must be of type
    // string. Received type number"). FONT_DIR is `fontDir()`'s own escape hatch for exactly
    // this, and this file is the one place in the app that still runs as plain, unbundled
    // Node — so it's where the real path can still be computed and handed down.
    if (!process.env.FONT_DIR) process.env.FONT_DIR = join(dir, 'packages', 'core', 'fonts');
    break;
  }
  const parent = dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not built output.
  transpilePackages: [
    '@cgp/adapters',
    '@cgp/config',
    '@cgp/contracts',
    '@cgp/core',
    '@cgp/db',
    '@cgp/orchestration',
    '@cgp/ui',
  ],
  /**
   * Required by Node at runtime rather than bundled. Two reasons, both worth keeping: bullmq,
   * the provider SDKs and the renderer load native binaries or their own transport modules,
   * which a bundle cannot carry; and fontkit and sharp are large enough that bundling them
   * dominates a cold route compile in development.
   */
  serverExternalPackages: [
    'bullmq',
    'ioredis',
    '@google/genai',
    'google-auth-library',
    '@anthropic-ai/vertex-sdk',
    '@resvg/resvg-js',
    'fontkit',
    'sharp',
  ],
};

export default nextConfig;
