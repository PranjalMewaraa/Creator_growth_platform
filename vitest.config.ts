import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages,tooling}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**'],
  },
});
