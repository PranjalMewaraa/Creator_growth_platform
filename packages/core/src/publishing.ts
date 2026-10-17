import { randomUUID } from 'node:crypto';
import type { Logger } from '@cgp/config';
import {
  checkPostMedia,
  PLATFORM_TEXT_LIMITS,
  type ModerationAdapter,
  type ModerationCategory,
  type ObjectStore,
  type PostContent,
  type PostTargetStatus,
  type TargetPlatform,
} from '@cgp/contracts';
import {
  brandKits,
  createPublication,
  findPublication,
  scoped,
  socialAccounts,
  type Database,
} from '@cgp/db';
import type { InputIssue } from './generators/registry';
import { fitToFrame, INSTAGRAM_FRAMES, type InstagramFrame } from './media';
import { enqueue, type Queues } from './queues';

/** Published limits on post text, from the one place they are written down. */
export const TEXT_LIMITS = PLATFORM_TEXT_LIMITS;

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IMAGE_TYPES = [
  { mimeType: 'image/jpeg', extension: 'jpg', magic: [0xff, 0xd8, 0xff] },
  { mimeType: 'image/png', extension: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
] as const;

/** The type the bytes really are; the browser's claim is not trusted. Shared with references.ts,
 *  which stores a different kind of upload but needs the same real-bytes sniff. */
export function sniffImage(data: Uint8Array) {
  return IMAGE_TYPES.find(({ magic }) => magic.every((byte, i) => data[i] === byte));
}

export type UploadResult =
  | {
      ok: true;
      key: string;
      url: string;
      mimeType: string;
      bytes: number;
      /** The 4:5 copy, Instagram's default. */
      instagramUrl: string;
      /** Every Instagram copy, by frame. */
      instagramUrls: Record<InstagramFrame, string>;
    }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] }
  | { ok: false; reason: 'blocked'; category: ModerationCategory }
  | { ok: false; reason: 'moderation_unavailable' };

/** An Instagram copy of an upload, beside the original. */
export function instagramKey(uploadKey: string, frame: InstagramFrame = 'portrait'): string {
  const suffix = frame === 'portrait' ? 'instagram' : 'instagram-square';
  return uploadKey.replace(/\.(jpg|png)$/, `.${suffix}.jpg`);
}

/** Bars fall back to black when the workspace has no brand kit yet. */
export async function barColour(db: Database, workspaceId: string): Promise<string> {
  const [kit] = await scoped(db, workspaceId).select(brandKits, {
    orderBy: (t, order) => order.desc(t.version),
    limit: 1,
  });
  return kit?.colors[0] ?? '#000000';
}

/**
 * Stores an image the user uploaded, after checking what it is and what it shows, together
 * with its Instagram copies (4:5 and 1:1 JPEGs): the whole image, bars in the brand colour.
 */
export async function storeUpload(
  deps: { db: Database; store: ObjectStore; moderation: ModerationAdapter; log: Logger },
  workspaceId: string,
  data: Uint8Array,
): Promise<UploadResult> {
  const invalid = (message: string): UploadResult => ({
    ok: false,
    reason: 'invalid_input',
    issues: [{ path: 'file', message }],
  });
  if (data.byteLength === 0) return invalid('The file is empty');
  if (data.byteLength > MAX_UPLOAD_BYTES) return invalid('Images can be at most 8 MB');
  const type = sniffImage(data);
  if (!type) return invalid('Only JPEG and PNG images are supported');

  try {
    const verdict = await deps.moderation.checkImage({ data, mimeType: type.mimeType });
    if (!verdict.allowed) {
      return { ok: false, reason: 'blocked', category: verdict.flagged[0]?.category ?? 'other' };
    }
  } catch (err) {
    deps.log.warn({ err }, 'image moderation unavailable, upload refused');
    return { ok: false, reason: 'moderation_unavailable' };
  }

  // Both frames now, so choosing one at publish time needs no second pass over the image.
  let copies: Array<[InstagramFrame, Uint8Array]>;
  try {
    const bars = await barColour(deps.db, workspaceId);
    copies = await Promise.all(
      (Object.keys(INSTAGRAM_FRAMES) as InstagramFrame[]).map(
        async (frame): Promise<[InstagramFrame, Uint8Array]> => [
          frame,
          await fitToFrame(data, INSTAGRAM_FRAMES[frame], bars),
        ],
      ),
    );
  } catch (err) {
    deps.log.warn({ err }, 'image could not be decoded');
    return invalid('The image could not be read; it may be damaged');
  }

  const key = `${workspaceId}/uploads/${randomUUID()}.${type.extension}`;
  const stored = await deps.store.put(key, data, type.mimeType);
  const urls = {} as Record<InstagramFrame, string>;
  for (const [frame, bytes] of copies) {
    urls[frame] = (await deps.store.put(instagramKey(key, frame), bytes, 'image/jpeg')).url;
  }
  return { ok: true, ...stored, instagramUrl: urls.portrait, instagramUrls: urls };
}

export interface PublishRequest {
  workspaceId: string;
  text: string;
  /** From storeUpload, for this workspace. */
  media?: { key: string };
  /** Which Instagram copy to post. Portrait, 4:5, unless asked otherwise. */
  instagramFrame?: InstagramFrame;
  accountIds: string[];
  timezone: string;
  /** When to post. Absent means now (WP31). */
  scheduledAt?: Date;
  /** The Studio output this post came from, kept as lineage (WP33). */
  sourceOutputId?: string;
  correlationId?: string;
}

/**
 * How far in the past a schedule may land before it is a mistake rather than a clock
 * difference. A minute covers a browser whose clock drifts and the time a form takes to post.
 */
const SCHEDULE_SLACK_MS = 60_000;

/** A year. Further than this is a typed year, not a plan. */
const SCHEDULE_HORIZON_MS = 365 * 24 * 60 * 60_000;

export type PublishResult =
  | { ok: true; publicationId: string; scheduledAt?: Date }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] }
  | { ok: false; reason: 'account_not_found' }
  | { ok: false; reason: 'blocked'; category: ModerationCategory }
  | { ok: false; reason: 'moderation_unavailable' };

/**
 * Post now, or at a time you choose (WP31): checks the post against each chosen platform's
 * rules and moderation, then creates the publication with one target and one publish job per
 * account. A post due now is enqueued here; a post for later waits for the dispatcher.
 *
 * Moderation runs when the post is written, not when it goes out. The text cannot change
 * between the two, so a second check would ask the same question of the same words.
 */
export async function startPublication(
  deps: {
    db: Database;
    queues: Queues;
    store: ObjectStore;
    moderation: ModerationAdapter;
    log: Logger;
  },
  request: PublishRequest,
): Promise<PublishResult> {
  const text = request.text.trim();
  const ids = [...new Set(request.accountIds)];
  if (!ids.every((id) => UUID.test(id))) return { ok: false, reason: 'account_not_found' };
  const accounts =
    ids.length === 0
      ? []
      : await scoped(deps.db, request.workspaceId).select(socialAccounts, {
          where: (t, op) => op.inArray(t.id, ids),
        });
  if (accounts.length !== ids.length) return { ok: false, reason: 'account_not_found' };

  const issues: InputIssue[] = [];
  if (ids.length === 0) issues.push({ path: 'accountIds', message: 'Choose at least one account' });
  if (!text && !request.media) issues.push({ path: 'text', message: 'Write something to post' });

  const now = Date.now();
  const scheduledAt = request.scheduledAt;
  if (scheduledAt) {
    if (Number.isNaN(scheduledAt.getTime())) {
      issues.push({ path: 'scheduledAt', message: 'That is not a time' });
    } else if (scheduledAt.getTime() < now - SCHEDULE_SLACK_MS) {
      issues.push({ path: 'scheduledAt', message: 'Pick a time in the future' });
    } else if (scheduledAt.getTime() > now + SCHEDULE_HORIZON_MS) {
      issues.push({ path: 'scheduledAt', message: 'Pick a time within the next year' });
    }
  }

  let media: PostContent['media'];
  if (request.media) {
    const { key } = request.media;
    // A key from another workspace is never usable here, whoever sent it.
    const image = /^[^/]+\/uploads\/[\w-]+\.(jpg|png)$/.exec(key);
    if (!key.startsWith(`${request.workspaceId}/uploads/`) || !image) {
      issues.push({ path: 'media', message: 'Upload the image again' });
    } else {
      media = {
        kind: 'image',
        url: deps.store.publicUrl(key),
        mimeType: image[1] === 'png' ? 'image/png' : 'image/jpeg',
      };
    }
  }

  for (const platform of new Set(accounts.map((a) => a.platform))) {
    const limit = TEXT_LIMITS[platform];
    if (text.length > limit) {
      issues.push({ path: 'text', message: `${name(platform)} allows ${limit} characters` });
    }
    // What this platform takes is declared beside the platform now, not decided here (WP36).
    // Checked as the platform will receive it, not as it was uploaded: Instagram is sent the
    // 4:5 JPEG copy, so a PNG upload is a JPEG by the time it goes out.
    issues.push(
      ...checkPostMedia(platform, {
        ...(media
          ? { kind: media.kind, mimeType: platform === 'instagram' ? 'image/jpeg' : media.mimeType }
          : {}),
        hasText: text.length > 0,
      }),
    );
  }
  if (issues.length > 0) return { ok: false, reason: 'invalid_input', issues };

  if (text) {
    try {
      const verdict = await deps.moderation.checkText(text);
      if (!verdict.allowed) {
        return { ok: false, reason: 'blocked', category: verdict.flagged[0]?.category ?? 'other' };
      }
    } catch (err) {
      deps.log.warn({ err }, 'text moderation unavailable, post refused');
      return { ok: false, reason: 'moderation_unavailable' };
    }
  }

  const content: PostContent = { text, ...(media ? { media } : {}) };
  const uploadKey = request.media?.key;
  // Instagram gets the 4:5 JPEG copy; every other platform the image as uploaded.
  const bodyFor = (platform: TargetPlatform): PostContent =>
    platform === 'instagram' && media && uploadKey
      ? {
          text,
          media: {
            kind: 'image',
            url: deps.store.publicUrl(instagramKey(uploadKey, request.instagramFrame)),
            mimeType: 'image/jpeg',
          },
        }
      : content;
  const created = await createPublication(deps.db, {
    workspaceId: request.workspaceId,
    timezone: request.timezone,
    ...(scheduledAt ? { scheduledAt } : {}),
    ...(request.sourceOutputId ? { sourceOutputId: request.sourceOutputId } : {}),
    body: { ...content },
    targets: accounts.map((account) => ({
      socialAccountId: account.id,
      body: { ...bodyFor(account.platform) },
    })),
    correlationId: request.correlationId,
  });
  if (!created.ok) return created;

  // A post for later is not enqueued now: it waits in Postgres with its time on it, and the
  // dispatcher puts it on the queue when the time comes. Enqueuing it here would publish it
  // immediately, which is the one thing a schedule must not do.
  const later = scheduledAt !== undefined && scheduledAt.getTime() > now;
  if (later) {
    deps.log.info(
      { publicationId: created.publication.id, scheduledAt, targets: created.targets.length },
      'publication scheduled',
    );
    return { ok: true, publicationId: created.publication.id, scheduledAt };
  }

  // After commit (invariant 7). A failed enqueue leaves the job QUEUED for the dispatcher.
  for (const job of created.jobs) {
    await enqueue(deps.queues, job).catch((err: unknown) => {
      deps.log.error({ err, jobId: job.id }, 'enqueue failed; the dispatcher will recover it');
    });
  }
  return { ok: true, publicationId: created.publication.id };
}

function name(platform: TargetPlatform) {
  return platform === 'instagram' ? 'Instagram' : 'LinkedIn';
}

export interface PublicationView {
  id: string;
  createdAt: string;
  /** When it goes out. The same as createdAt for a post now (WP31). */
  scheduledAt: string;
  text: string;
  mediaUrl: string | null;
  targets: Array<{
    id: string;
    platform: TargetPlatform;
    account: string;
    status: PostTargetStatus;
    permalink: string | null;
    publishedAt: string | null;
    error: { code: string; message: string } | null;
  }>;
}

export async function publicationView(
  db: Database,
  workspaceId: string,
  publicationId: string,
): Promise<PublicationView | undefined> {
  if (!UUID.test(publicationId)) return undefined;
  const found = await findPublication(db, workspaceId, publicationId);
  if (!found) return undefined;
  const body = found.publication.body as Partial<PostContent>;
  return {
    id: found.publication.id,
    createdAt: found.publication.createdAt.toISOString(),
    scheduledAt: found.publication.scheduledAt.toISOString(),
    text: body.text ?? '',
    mediaUrl: body.media?.url ?? null,
    targets: found.targets.map(({ target, account }) => {
      const error = target.lastError as { code?: string; message?: string } | null;
      return {
        id: target.id,
        platform: account.platform,
        account: account.displayName ?? account.externalId,
        status: target.status,
        permalink: target.permalink,
        publishedAt: target.publishedAt?.toISOString() ?? null,
        error: error ? { code: error.code ?? 'UNKNOWN', message: error.message ?? '' } : null,
      };
    }),
  };
}

/** Connected accounts, without anything secret. */
export async function listAccounts(db: Database, workspaceId: string) {
  const rows = await scoped(db, workspaceId).select(socialAccounts, {
    orderBy: (t, order) => order.asc(t.platform),
  });
  return rows.map(
    ({ id, platform, displayName, externalId, health, scopes, tokenExpiresAt, sharedDemo }) => ({
      id,
      platform,
      displayName: displayName ?? externalId,
      health,
      // What the person allowed, shown as the platform named it (S-19).
      scopes,
      tokenExpiresAt: tokenExpiresAt?.toISOString() ?? null,
      /** The team's own account, borrowed rather than connected (WP52): said plainly, never hidden. */
      sharedDemo,
    }),
  );
}
