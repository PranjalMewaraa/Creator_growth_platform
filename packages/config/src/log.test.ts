import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, withCorrelation } from './log';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { lines, logger: createLogger({ service: 'test', destination }) };
}

describe('createLogger', () => {
  it('stamps the correlation id on every line inside a correlated scope', async () => {
    const { lines, logger } = capture();
    await withCorrelation('corr-1', async () => {
      logger.info('before await');
      await Promise.resolve();
      logger.info('after await');
    });
    logger.info('outside');

    expect(lines.map((l) => l.correlationId)).toEqual(['corr-1', 'corr-1', undefined]);
    expect(lines[0]?.service).toBe('test');
  });

  it('generates an id when none is supplied', () => {
    const { lines, logger } = capture();
    withCorrelation(undefined, () => logger.info('x'));
    expect(lines[0]?.correlationId).toEqual(expect.any(String));
  });
});
