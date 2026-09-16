import { baseEnvSchema, loadRootEnvFile, parseEnv } from '@cgp/config';
import { runMigrations } from '../migrate';

loadRootEnvFile();
const { DATABASE_URL } = parseEnv(baseEnvSchema.pick({ DATABASE_URL: true }));
await runMigrations(DATABASE_URL);
console.log('Migrations applied');
