/** A stored media object. `url` is where a platform can fetch it (Instagram pulls by URL). */
export interface StoredObject {
  key: string;
  url: string;
  mimeType: string;
  bytes: number;
}

/**
 * Media storage (plan section 5). Keys are chosen by the caller and start with the workspace
 * id, so one workspace's media never lands under another's prefix.
 */
export interface ObjectStore {
  readonly key: string;
  put(key: string, data: Uint8Array, mimeType: string): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  publicUrl(key: string): string;
}
