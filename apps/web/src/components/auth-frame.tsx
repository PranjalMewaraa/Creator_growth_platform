import Image from 'next/image';
import type { ReactNode } from 'react';
import hero from '@/assets/login-hero.jpg';
import { Logo } from './logo';

/** Full screen split for sign in and setup: artwork on the left, the task on the right. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden p-3 lg:block">
        <div className="relative h-full overflow-hidden rounded-[24px]">
          <Image
            src={hero}
            alt=""
            fill
            preload
            placeholder="blur"
            sizes="(min-width: 1024px) 50vw, 0px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/30" />
          <Logo className="absolute left-8 top-8" />
          <div className="absolute inset-x-8 bottom-10">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">
              From idea to posted.
            </h2>
            <p className="mt-3 max-w-md text-base text-white/80">
              Say what you want in plain words. Plan, create and publish to Instagram and LinkedIn
              from one workspace.
            </p>
          </div>
        </div>
      </aside>

      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          {children}
        </div>
      </section>
    </main>
  );
}
