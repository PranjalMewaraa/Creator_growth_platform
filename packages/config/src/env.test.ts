import { describe, expect, it } from 'vitest';
import { baseEnvSchema, parseEnv } from './env';

const valid = {
  DATABASE_URL: 'postgres://cgp:cgp@localhost:5432/cgp',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseEnv', () => {
  it('applies defaults, with providers fake unless set', () => {
    const env = parseEnv(baseEnvSchema, valid);
    expect(env.PROVIDERS).toBe('fake');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.NODE_ENV).toBe('development');
  });

  it('names every missing or invalid variable', () => {
    expect(() =>
      parseEnv(baseEnvSchema, { REDIS_URL: 'not a url', PROVIDERS: 'sometimes' }),
    ).toThrow(/DATABASE_URL[\s\S]*REDIS_URL[\s\S]*PROVIDERS/);
  });
});
