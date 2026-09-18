import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generators } from '@cgp/core';
import { describe, expect, it } from 'vitest';

// FR-GN-02: adding a generator touches no route file. Routes take the generator key from the
// URL and ask the registry, so no API file may name a generator.
const apiDir = fileURLToPath(new URL('../apps/web/src/app/api', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

describe('generator routing (FR-GN-02)', () => {
  it('no API route names a generator', () => {
    const keys = generators.list().map((g) => g.key);
    const offenders = files(apiDir).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return keys
        .filter((key) => new RegExp(`['"\`]${key}['"\`]`).test(source))
        .map((key) => `${file}: ${key}`);
    });
    expect(offenders).toEqual([]);
  });
});
