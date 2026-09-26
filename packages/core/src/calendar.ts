import type { JobStatus, PostContent, PostTargetStatus, TargetPlatform } from '@cgp/contracts';
import { publicationsBetween, type Database } from '@cgp/db';

/**
 * The calendar's week (S-07, WP34). One card per publication, carrying a chip per target,
 * because status lives on the target and never on the parent (plan section 14): a post that
 * reached LinkedIn and failed on Instagram is a normal outcome, and the card has to be able
 * to say so rather than picking one word for both.
 */

export type RenderState = 'rendering' | 'failed' | null;

export interface CalendarTarget {
  id: string;
  platform: TargetPlatform;
  account: string;
  status: PostTargetStatus;
  permalink: string | null;
}

export interface CalendarPost {
  id: string;
  /** When it goes out, or went out. */
  scheduledAt: string;
  text: string;
  mediaUrl: string | null;
  targets: CalendarTarget[];
  /**
   * Whether the media behind the post is still being made. Null for a post written in the
   * composer from an upload, which is everything until the Studio hands an output to the
   * composer; a reel scheduled straight from a render is the case this exists for.
   */
  render: RenderState;
}

/**
 * What the card says about the media behind a post. A job that has not ended is still being
 * made; one that ended any way but COMPLETE will never produce the media, and the card should
 * say so rather than leaving a post on the grid that cannot go out with what it promised.
 */
export function renderStateFor(status: JobStatus | null): RenderState {
  if (status === null || status === 'COMPLETE') return null;
  return status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED'
    ? 'failed'
    : 'rendering';
}

/** A week, from this instant to that one. The caller's week, in the caller's timezone. */
export async function calendarWeek(
  db: Database,
  workspaceId: string,
  from: Date,
  to: Date,
): Promise<CalendarPost[]> {
  const rows = await publicationsBetween(db, workspaceId, from, to);
  return rows.map(({ publication, targets, renderStatus }) => {
    const body = publication.body as Partial<PostContent>;
    return {
      id: publication.id,
      scheduledAt: publication.scheduledAt.toISOString(),
      text: body.text ?? '',
      mediaUrl: body.media?.url ?? null,
      targets: targets.map(({ target, account }) => ({
        id: target.id,
        platform: account.platform,
        account: account.displayName ?? account.externalId,
        status: target.status,
        permalink: target.permalink,
      })),
      render: renderStateFor(renderStatus),
    };
  });
}
