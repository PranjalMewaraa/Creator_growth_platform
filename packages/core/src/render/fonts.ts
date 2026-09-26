import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Where the pinned fonts live: the text layer draws with them and libass renders captions with
 * them, so a caption looks the same on every machine (docs/spikes/ffmpeg-captions.md).
 *
 * Resolved through the package rather than as a URL relative to this file: a bundler rewrites
 * `new URL('../fonts/', import.meta.url)` at build time and then cannot find a directory.
 * FONT_DIR overrides it for a deployment that keeps the files somewhere else.
 */
export function fontDir(): string {
  if (process.env.FONT_DIR) return process.env.FONT_DIR;
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('@cgp/core/package.json')), 'fonts');
}
