import type { Logger } from '@cgp/config';
import type { ObjectStore } from '@cgp/contracts';
import { createGoogleAuth } from '../google-auth';
import { normalizeError } from '../errors';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers,
  ) {
    super(`HTTP ${status}`);
  }
}

export interface GcsStoreOptions {
  bucket: string;
  project: string;
  log?: Logger;
  /** Base64'd service-account JSON, for hosts with no filesystem (Vercel). */
  credentialsB64?: string;
}

/**
 * Google Cloud Storage in the project's own bucket. Objects are publicly readable by URL, with
 * unguessable keys, because Instagram fetches media itself; anything published is public on
 * the platform anyway. Moving to R2 or signed URLs later is a change inside this file.
 */
export function createGcsStore(options: GcsStoreOptions): ObjectStore {
  const auth = createGoogleAuth(
    'https://www.googleapis.com/auth/devstorage.read_write',
    options.credentialsB64,
  );
  const object = (key: string) => encodeURIComponent(key);

  async function request(method: string, url: string, body?: Uint8Array, mimeType?: string) {
    const headers = new Headers(await (await auth.getClient()).getRequestHeaders(url));
    headers.set('x-goog-user-project', options.project);
    if (mimeType) headers.set('content-type', mimeType);
    // A fresh copy is ArrayBuffer backed, which every fetch typing accepts as a body.
    const response = await fetch(url, {
      method,
      headers,
      body: body ? new Uint8Array(body) : undefined,
    });
    if (!response.ok) throw new HttpError(response.status, response.headers);
    return response;
  }

  const store: ObjectStore = {
    key: 'gcs',

    publicUrl: (key) =>
      `https://storage.googleapis.com/${options.bucket}/${key.split('/').map(encodeURIComponent).join('/')}`,

    async put(key, data, mimeType) {
      try {
        await request(
          'POST',
          `https://storage.googleapis.com/upload/storage/v1/b/${options.bucket}/o?uploadType=media&name=${object(key)}`,
          data,
          mimeType,
        );
        return { key, url: store.publicUrl(key), mimeType, bytes: data.byteLength };
      } catch (err) {
        throw normalizeError('storage', err, options.log);
      }
    },

    async get(key) {
      try {
        const response = await request(
          'GET',
          `https://storage.googleapis.com/storage/v1/b/${options.bucket}/o/${object(key)}?alt=media`,
        );
        return new Uint8Array(await response.arrayBuffer());
      } catch (err) {
        throw normalizeError('storage', err, options.log);
      }
    },
  };
  return store;
}
