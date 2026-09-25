// Adds a track to the music catalogue (WP24, FR-VD-08). Every track carries its licence,
// because a bed with no licence recorded is a legal problem wearing a demo's clothes.
//
//   pnpm --filter @cgp/worker music:add <file> --title "Name" --source "..." --licence CC0-1.0 [--attribution "..."]
//
// The file is uploaded to the media bucket and the row records where it came from and on what
// terms. Nothing ships in the repository: tracks are yours to choose and to be able to defend.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { baseEnvSchema, createLogger, loadRootEnvFile, parseEnv } from '@cgp/config';
import { createProviders } from '@cgp/adapters';
import { addMusicTrack, createDatabase, listMusicTracks } from '@cgp/db';

loadRootEnvFile();
const env = parseEnv(baseEnvSchema);
const log = createLogger({ service: 'music', level: env.LOG_LEVEL });

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

const [file] = args.filter(
  (arg) => !arg.startsWith('--') && !args[args.indexOf(arg) - 1]?.startsWith('--'),
);
const title = flag('title');
const source = flag('source');
const licence = flag('licence');
const attribution = flag('attribution') ?? '';

const db = createDatabase(env.DATABASE_URL, { max: 1 });
const providers = createProviders({ ...env, log });

try {
  if (!file || !title || !source || !licence) {
    const tracks = await listMusicTracks(db);
    log.info({ tracks: tracks.map((t) => t.title) }, 'catalogue');
    throw new Error(
      'Usage: music:add <file> --title "Name" --source "where it came from" --licence CC0-1.0 [--attribution "..."]',
    );
  }

  const data = new Uint8Array(readFileSync(file));
  const key = `catalog/music/${basename(file, extname(file))}${extname(file) || '.mp3'}`;
  const stored = await providers.store.put(key, data, 'audio/mpeg');
  const row = await addMusicTrack(db, {
    title,
    storageKey: stored.key,
    licence: { source, licence, attribution },
  });
  log.info({ id: row.id, title: row.title, key: stored.key }, 'track added');
} finally {
  await db.close();
}
