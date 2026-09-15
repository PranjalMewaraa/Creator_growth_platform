import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// Boundaries are syntax rules, so the type aware project setup is not needed to test them.
const eslint = new ESLint({
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  overrideConfig: tseslint.configs.disableTypeChecked,
});

async function restrictedImports(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
}

// The first lint loads every plugin, which can pass 5s while other test files run in parallel.
describe('import boundaries', { timeout: 30_000 }, () => {
  it('blocks database drivers outside packages/db', async () => {
    const errors = await restrictedImports(
      'apps/web/src/app/leak.ts',
      "import { sql } from 'drizzle-orm';\nexport const q = sql;\n",
    );
    expect(errors).toHaveLength(1);
  });

  it('blocks provider SDKs, including type imports, outside packages/adapters', async () => {
    const errors = await restrictedImports(
      'packages/orchestration/src/leak.ts',
      "import type { GoogleGenAI } from '@google/genai';\nexport type G = GoogleGenAI;\n",
    );
    expect(errors).toHaveLength(1);
  });

  it('allows each package its own dependency, and nothing else', async () => {
    const drizzle = "import { sql } from 'drizzle-orm';\nexport const q = sql;\n";
    const genai = "import { GoogleGenAI } from '@google/genai';\nexport const G = GoogleGenAI;\n";

    expect(await restrictedImports('packages/db/src/ok.ts', drizzle)).toHaveLength(0);
    expect(await restrictedImports('packages/adapters/text/ok.ts', genai)).toHaveLength(0);
    expect(await restrictedImports('packages/adapters/text/leak.ts', drizzle)).toHaveLength(1);
    expect(await restrictedImports('packages/db/src/leak.ts', genai)).toHaveLength(1);
  });
});
