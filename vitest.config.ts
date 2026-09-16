import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages,tooling}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
    // Database test files each boot PGlite and apply every migration in beforeAll. In
    // parallel that passes the 10s default, so setup gets more room than a test does.
    hookTimeout: 60_000,
  },
});
