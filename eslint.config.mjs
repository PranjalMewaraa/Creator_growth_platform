import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Plan section 4 and 18 boundaries, enforced at lint time rather than by review.
const DATABASE_DRIVERS = {
  group: [
    'drizzle-orm',
    'drizzle-orm/*',
    'drizzle-kit',
    'postgres',
    'pg',
    'pg/*',
    '@electric-sql/pglite',
    '@electric-sql/pglite/*',
  ],
  message: 'Database access goes through the @cgp/db workspace scoped helpers only (invariant 1).',
};
const PROVIDER_SDKS = {
  group: [
    '@google/genai',
    '@google/genai/*',
    '@anthropic-ai/*',
    '@google-cloud/*',
    'openai',
    'openai/*',
  ],
  message: 'Provider SDKs and their types stay inside packages/adapters (invariant 3).',
};
const restrict = (...patterns) => ['error', { patterns }];

const WEB_FILES = ['apps/web/**/*.{js,jsx,mjs,ts,tsx}'];

export default defineConfig(
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/dist/**',
    '**/coverage/**',
    '**/next-env.d.ts',
  ]),

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  { rules: { 'no-restricted-imports': restrict(DATABASE_DRIVERS, PROVIDER_SDKS) } },
  { files: ['packages/db/**'], rules: { 'no-restricted-imports': restrict(PROVIDER_SDKS) } },
  {
    files: ['packages/adapters/**'],
    rules: { 'no-restricted-imports': restrict(DATABASE_DRIVERS) },
  },

  // Next.js rules apply to the web app only.
  nextVitals
    .filter((config) => config.files || config.rules || config.plugins)
    .map((config) => ({ ...config, files: WEB_FILES })),
  {
    files: WEB_FILES,
    settings: { next: { rootDir: 'apps/web' }, react: { version: '19' } },
  },
);
