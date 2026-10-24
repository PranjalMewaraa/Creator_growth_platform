import { GoogleAuth } from 'google-auth-library';

/**
 * Google's SDKs normally read a service-account key from a file path in
 * GOOGLE_APPLICATION_CREDENTIALS, which Vercel (no filesystem) can't provide. credentialsB64
 * is the same base64'd key already used for the worker's Dockerfile, handed to GoogleAuth as
 * in-memory JSON instead of a file path — works anywhere an env var does. Falls back to the
 * SDK's normal application-default-credentials lookup when unset, unchanged from before.
 */
export function createGoogleAuth(scopes: string, credentialsB64?: string): GoogleAuth {
  if (!credentialsB64) return new GoogleAuth({ scopes });
  const credentials = JSON.parse(Buffer.from(credentialsB64, 'base64').toString('utf8'));
  return new GoogleAuth({ credentials, scopes });
}
