import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, parseEncryptionKey } from './secrets';

const kek = randomBytes(32);

describe('token envelope encryption (D11)', () => {
  it('round trips, and never stores the token in the clear', () => {
    const stored = encryptSecret(kek, 'IGAA-secret-token');
    expect(stored).not.toContain('secret');
    expect(stored.startsWith('v1.')).toBe(true);
    expect(decryptSecret(kek, stored)).toBe('IGAA-secret-token');
  });

  it('uses a fresh data key each time', () => {
    expect(encryptSecret(kek, 'same')).not.toBe(encryptSecret(kek, 'same'));
  });

  it('refuses another key and tampered ciphertext', () => {
    const stored = encryptSecret(kek, 'token');
    expect(() => decryptSecret(randomBytes(32), stored)).toThrow();
    const tampered = `${stored.slice(0, -2)}${stored.endsWith('A') ? 'B' : 'A'}A`;
    expect(() => decryptSecret(kek, tampered)).toThrow();
  });

  it('checks the key length', () => {
    expect(() => parseEncryptionKey('short')).toThrow(/32 bytes/);
    expect(parseEncryptionKey(kek.toString('base64url'))).toEqual(kek);
  });
});
