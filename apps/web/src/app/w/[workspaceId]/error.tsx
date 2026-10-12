'use client';

import { useEffect } from 'react';
import { Trouble } from '@/components/trouble';

/**
 * A screen inside the workspace threw (WP51). The shell around it stays, so the rail and the
 * balances still work and the person can simply go somewhere else.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Trouble
      title="This screen could not be shown"
      action={
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-11 cursor-pointer items-center rounded-xl bg-accent px-5 text-body font-medium text-accent-ink transition duration-base ease-standard hover:opacity-90"
        >
          Try again
        </button>
      }
    >
      <p>
        Nothing you made has been lost: jobs, posts and the calendar live on the server. If this
        keeps happening, the reference below is what to quote.
      </p>
      {error.digest ? (
        <p className="mt-2 text-caption text-faint">Reference {error.digest}</p>
      ) : null}
    </Trouble>
  );
}
