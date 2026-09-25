import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { NextConfig } from 'next';

// The root .env, read here rather than through @cgp/config: this file is evaluated before the
// dev server starts, and importing a workspace package makes the toolchain transpile that
// package and its dependencies first, which measured at about 15 seconds of startup.
for (let dir = process.cwd(); ;) {
  if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    if (existsSync(join(dir, '.env'))) process.loadEnvFile(join(dir, '.env'));
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
