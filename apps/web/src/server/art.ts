import 'server-only';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Card art dropped into public/art, sorted by name; empty until images are added. */
export function listArt(): string[] {
  try {
    return readdirSync(join(process.cwd(), 'public', 'art'))
      .filter((file) => /\.(jpe?g|png|webp)$/i.test(file))
      .sort()
      .map((file) => `/art/${file}`);
  } catch {
    return [];
  }
}
