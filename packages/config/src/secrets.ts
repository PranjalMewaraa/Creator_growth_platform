import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// D11: envelope encryption for social tokens. Each token gets its own random data key; the
// data key is stored wrapped by the key encryption key, which lives only in the environment
// (TOKEN_ENCRYPTION_KEY), never in the database. Both layers are AES-256-GCM.
//
// Stored form: v1.<wrapped data key>.<token ciphertext>, each part base64url of iv|tag|bytes.

const VERSION = 'v1';

function seal(key: Buffer, plain: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

function open(key: Buffer, sealed: string): Buffer {
  const bytes = Buffer.from(sealed, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
}

/** The key encryption key: 32 bytes, base64url, from TOKEN_ENCRYPTION_KEY. */
export function parseEncryptionKey(value: string | undefined): Buffer {
  const key = Buffer.from(value ?? '', 'base64url');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64url encoded');
  }
  return key;
}

export function encryptSecret(kek: Buffer, secret: string): string {
  const dataKey = randomBytes(32);
  return [VERSION, seal(kek, dataKey), seal(dataKey, Buffer.from(secret, 'utf8'))].join('.');
}

/** Throws when the value was tampered with or sealed under another key. */
export function decryptSecret(kek: Buffer, stored: string): string {
  const [version, wrapped, body] = stored.split('.');
  if (version !== VERSION || !wrapped || !body) throw new Error('Unrecognised secret format');
  return open(open(kek, wrapped), body).toString('utf8');
}
