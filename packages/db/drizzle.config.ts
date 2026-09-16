import { defineConfig } from 'drizzle-kit';

// Generating migrations needs no database connection. Applying them: pnpm db:migrate.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});
