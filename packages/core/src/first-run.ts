import type { Database } from '@cgp/db';
import { brandKitHistory } from './brand-kit';
import { profileHistory } from './profile';
import { listAccounts } from './publishing';
import { recentGenerationJobs } from './studio';

/**
 * First run (WP48): the four things a new workspace needs before it can do the thing it is
 * for, and which of them are done.
 *
 * It is deliberately not a wizard. Three of the four steps happen on screens that exist for
 * their own reasons and are returned to long after the first week — the brand kit is edited,
 * accounts are reconnected, the Studio is the product — so taking them over with a modal
 * sequence would mean building each one twice. What was actually missing was the thread
 * between them: onboarding ended by dropping you on the Brand screen with no sense of what
 * came next, and nothing anywhere said that a workspace with no connected account can still
 * make and schedule posts, it just cannot publish them.
 *
 * So the state lives here, on the server, read from what has really been saved rather than
 * from a flag that can disagree with it. Delete the profile and the step comes back.
 */

export type FirstRunKey = 'profile' | 'brand' | 'account' | 'generate';

export interface FirstRunStep {
  key: FirstRunKey;
  title: string;
  /** What the step is, in the time it takes to decide whether to do it now. */
  what: string;
  done: boolean;
  /** Where it is done, under the workspace. */
  path: string;
  cta: string;
  /**
   * Required means nothing downstream works at all, not that we would rather you did it.
   * Only the profile is required: the compiler has no voice, no pillars and no goal without
   * it, and every generator refuses.
   */
  required: boolean;
  /** What is lost by leaving it. Said plainly, and true — these are not nudges. */
  breaks: string;
}

export interface FirstRunState {
  steps: FirstRunStep[];
  done: number;
  total: number;
  /** The first unfinished step, which is the one the screen should offer. */
  next: FirstRunStep | null;
  complete: boolean;
}

export async function firstRun(db: Database, workspaceId: string): Promise<FirstRunState> {
  const [profiles, kits, accounts, jobs] = await Promise.all([
    profileHistory(db, workspaceId),
    brandKitHistory(db, workspaceId),
    listAccounts(db, workspaceId),
    recentGenerationJobs(db, workspaceId, 1),
  ]);

  const steps: FirstRunStep[] = [
    {
      key: 'profile',
      title: 'Tell us about your content',
      what: 'Eight questions: what you make, where, for what goal and in what voice.',
      done: profiles.length > 0,
      path: '/onboarding',
      cta: 'Answer them',
      required: true,
      breaks: 'Nothing can be generated until these are answered. Every prompt is built on them.',
    },
    {
      key: 'brand',
      title: 'Set the look',
      what: 'Two colours, a font and a logo, applied to every image and caption card.',
      done: kits.length > 0,
      path: '/brand',
      cta: 'Set it up',
      required: false,
      breaks: 'Images still generate, in the default palette, with no logo on them.',
    },
    {
      key: 'account',
      title: 'Connect a channel',
      what: 'Instagram or LinkedIn, so finished posts have somewhere to go.',
      done: accounts.length > 0,
      path: '/accounts',
      cta: 'Connect one',
      required: false,
      breaks:
        'You can write, generate and schedule. Nothing will publish, and the sync centre stays empty.',
    },
    {
      key: 'generate',
      title: 'Make something',
      what: 'A script, a storyboard or a reel, from one line of intent.',
      done: jobs.length > 0,
      path: '/studio',
      cta: 'Open the Studio',
      required: false,
      breaks: 'This is the one step that is not setup. It is what the other three were for.',
    },
  ];

  const done = steps.filter((step) => step.done).length;
  return {
    steps,
    done,
    total: steps.length,
    next: steps.find((step) => !step.done) ?? null,
    complete: done === steps.length,
  };
}
