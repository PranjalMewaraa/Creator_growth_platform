import type { NormalizedError } from '../errors';
import type { TargetPlatform } from '../generator';

/** Decrypted by the worker for the duration of one call. Never logged, never persisted here. */
export interface PublishAccount {
  externalId: string;
  accessToken: string;
}

export interface PostContent {
  text: string;
  /** A signed, publicly fetchable URL: Instagram pulls media from a URL rather than taking an upload. */
  media?: { kind: 'image' | 'video'; url: string; mimeType: string };
}

/** A platform side draft (Instagram container, LinkedIn registered upload). Nothing is public yet. */
export interface PreparedPost {
  platform: TargetPlatform;
  ref: string;
}

export type PreparedState =
  { state: 'processing' } | { state: 'ready' } | { state: 'failed'; error: NormalizedError };

export interface PublishedPost {
  platformPostId: string;
  permalink?: string;
}

/** A field is absent when the platform does not report it. Never estimated, never filled in. */
export interface PostMetrics {
  fetchedAt: string;
  views?: number;
  reach?: number;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
}

export interface Publisher {
  readonly platform: TargetPlatform;
  /** Safe to retry: creates a draft only. */
  prepare(account: PublishAccount, content: PostContent): Promise<PreparedPost>;
  /** Poll until ready. Instagram processes containers asynchronously; LinkedIn is ready at once. */
  check(account: PublishAccount, prepared: PreparedPost): Promise<PreparedState>;
  /**
   * Irreversible. Call only after the target is claimed, and persist the returned id before
   * anything else (invariant 9).
   */
  publish(account: PublishAccount, prepared: PreparedPost): Promise<PublishedPost>;
  metrics(account: PublishAccount, platformPostId: string): Promise<PostMetrics>;
}
