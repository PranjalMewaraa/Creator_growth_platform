'use client';

import { useEffect } from 'react';
import { Trouble } from '@/components/trouble';

/** Something threw before a page could render, outside any workspace shell (WP51). */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The stack belongs in the console, where whoever is debugging will look; the page
    // says what happened in words.
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-canvas">
      <Trouble
        title="Something went wrong"
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
          The page could not be shown. Nothing you made has been lost: every job and post is kept on
          the server, not on this screen.
        </p>
        {error.digest ? (
          <p className="mt-2 text-caption text-faint">Reference {error.digest}</p>
        ) : null}
      </Trouble>
    </main>
  );
}
