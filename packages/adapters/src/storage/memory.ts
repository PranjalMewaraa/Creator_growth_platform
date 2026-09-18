import { AdapterError, type ObjectStore } from '@cgp/contracts';

/** Storage for tests and fake mode: nothing leaves the process. */
export function createMemoryStore(baseUrl = 'https://fake-storage.invalid'): ObjectStore {
  const objects = new Map<string, Uint8Array>();
  const store: ObjectStore = {
    key: 'memory',
    publicUrl: (key) => `${baseUrl}/${key}`,
    put(key, data, mimeType) {
      objects.set(key, data);
      return Promise.resolve({ key, url: store.publicUrl(key), mimeType, bytes: data.byteLength });
    },
    get(key) {
      const data = objects.get(key);
      return data
        ? Promise.resolve(data)
        : Promise.reject(
            new AdapterError({ code: 'HTTP_404', message: 'no such object', category: 'terminal' }),
          );
    },
  };
  return store;
}
