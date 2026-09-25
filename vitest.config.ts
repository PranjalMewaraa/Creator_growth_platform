import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// The root .env, so a test reads the same configuration the apps do. It matters for the ones
// that need a real tool or a live provider: FFMPEG_PATH decides whether the render tests run,
// and a test that silently skips is worse than one that fails.
if (existsSync('.env')) process.loadEnvFile('.env');

function ffmpegPath(): string {
  const configured = process.env.FFMPEG_PATH ?? 'ffmpeg';
  if (!/[/\\]/.test(configured) || isAbsolute(configured)) return configured;
  return resolve(configured);
}

export default defineConfig({
  test: {
    include: ['{apps,packages,tooling}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    // Database test files each boot PGlite and apply every migration in beforeAll. In
    // parallel that passes the 10s default, so setup gets more room than a test does.
    hookTimeout: 60_000,
    // Absolute, because a test file's own directory is not the repository root.
    env: { FFMPEG_PATH: ffmpegPath() },
  },
});
