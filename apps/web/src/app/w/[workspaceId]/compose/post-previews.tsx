'use client';

import { useState, type ReactNode, type SVGProps } from 'react';

// Feed previews in each platform's dark theme, so the post is judged as people will see it.
// They are approximations of the layouts, not copies of either product: no logos, simple icons.

const TOKEN = /(#[\p{L}\p{N}_]+|@[\w.]+|https?:\/\/\S+)/u;

/** Hashtags, mentions and links in the platform's link colour. */
function Rich({ text, linkClass }: { text: string; linkClass: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className={linkClass}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** The cut the feeds make before "more": by lines first, then by characters. */
function truncate(text: string, maxLines: number, maxChars: number) {
  const lines = text.split('\n');
  let cut = lines.slice(0, maxLines).join('\n');
  if (cut.length > maxChars) cut = cut.slice(0, maxChars).replace(/\s+\S*$/, '');
  return { shown: cut.trimEnd(), truncated: cut.length < text.trimEnd().length };
}

function Avatar({ name, className }: { name: string; className: string }) {
  const initial = name.replace(/^@/, '').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-hot font-semibold text-accent-ink ${className}`}
    >
      {initial}
    </span>
  );
}

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

const Heart = () => (
  <Icon className="h-6 w-6">
    <path d="M12 20s-7-4.35-9.2-8.5C1.1 8.2 3 4.5 6.6 4.5c2.1 0 3.4 1.2 4.4 2.6h2c1-1.4 2.3-2.6 4.4-2.6 3.6 0 5.5 3.7 3.8 7C19 15.65 12 20 12 20z" />
  </Icon>
);
const Bubble = () => (
  <Icon className="h-6 w-6">
    <path d="M20.5 11.5a8.5 8.5 0 0 1-12.6 7.4L3.5 20l1.2-4.1A8.5 8.5 0 1 1 20.5 11.5z" />
  </Icon>
);
const Plane = () => (
  <Icon className="h-6 w-6">
    <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z" />
  </Icon>
);
const Bookmark = () => (
  <Icon className="h-6 w-6">
    <path d="M6 3.5h12v17l-6-4.2-6 4.2z" />
  </Icon>
);
const Dots = () => (
  <Icon className="h-5 w-5">
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </Icon>
);
const Globe = () => (
  <Icon className="h-3 w-3" strokeWidth={2}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
  </Icon>
);
const ThumbUp = () => (
  <Icon className="h-5 w-5">
    <path d="M7 10v10H4V10h3zm0 0 4-6.5c1.3 0 2.2 1 2 2.3L12.5 9H19a2 2 0 0 1 2 2.3l-1.2 6.8A2 2 0 0 1 17.8 20H7" />
  </Icon>
);
const Repost = () => (
  <Icon className="h-5 w-5">
    <path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1" />
  </Icon>
);

export function InstagramPost({
  username,
  text,
  image,
  barColour,
  frame = 'portrait',
}: {
  username: string;
  text: string;
  image: string | null;
  barColour: string;
  frame?: 'portrait' | 'square';
}) {
  const [open, setOpen] = useState(false);
  const { shown, truncated } = truncate(text, 2, 125);
  const handle = username.replace(/^@/, '');

  return (
    <article className="w-full max-w-[380px] overflow-hidden rounded-xl border border-white/10 bg-black text-[14px] leading-[18px] text-[#f5f5f5]">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="rounded-full bg-gradient-to-tr from-[#f9ce34] via-[#ee2a7b] to-[#6228d7] p-[2px]">
          <span className="block rounded-full bg-black p-[2px]">
            <Avatar name={handle} className="h-7 w-7 text-xs" />
          </span>
        </span>
        <span className="flex-1 truncate font-semibold">{handle}</span>
        <span className="text-[#f5f5f5]">
          <Dots />
        </span>
      </header>

      {/* The same fit the server makes: contain in the frame, bars in the brand colour. */}
      <div
        className={frame === 'portrait' ? 'aspect-[4/5] w-full' : 'aspect-square w-full'}
        style={{ backgroundColor: barColour }}
      >
        {image ? (
          // A local object URL: next/image cannot optimise it, and need not.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/60">
            Instagram posts need an image
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 px-3 pt-2.5">
        <Heart />
        <Bubble />
        <Plane />
        <span className="ml-auto">
          <Bookmark />
        </span>
      </div>

      <div className="px-3 pb-3 pt-2">
        {text.trim() ? (
          <p className="whitespace-pre-wrap break-words">
            <span className="mr-1 font-semibold">{handle}</span>
            <Rich text={open ? text.trimEnd() : shown} linkClass="text-[#e0f1ff]" />
            {truncated && !open ? (
              <>
                {'… '}
                <button type="button" onClick={() => setOpen(true)} className="text-[#a8a8a8]">
                  more
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        <p className="mt-1.5 text-[11px] uppercase tracking-wide text-[#a8a8a8]">Just now</p>
      </div>
    </article>
  );
}

export function LinkedInPost({
  name,
  text,
  image,
}: {
  name: string;
  text: string;
  image: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { shown, truncated } = truncate(text, 3, 210);
  const actions = [
    { label: 'Like', icon: <ThumbUp /> },
    { label: 'Comment', icon: <Bubble /> },
    { label: 'Repost', icon: <Repost /> },
    { label: 'Send', icon: <Plane /> },
  ];

  return (
    <article className="w-full max-w-[520px] overflow-hidden rounded-lg border border-white/10 bg-[#1b1f23] text-[14px] leading-5 text-white/90">
      <header className="flex items-start gap-2 px-4 pt-3">
        <Avatar name={name} className="h-12 w-12 text-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-xs text-white/60">Creator</p>
          <p className="flex items-center gap-1 text-xs text-white/60">
            Now · <Globe />
          </p>
        </div>
        <span className="text-white/60">
          <Dots />
        </span>
      </header>

      {text.trim() ? (
        <p className="whitespace-pre-wrap break-words px-4 pb-2 pt-2">
          <Rich text={open ? text.trimEnd() : shown} linkClass="font-semibold text-[#71b7fb]" />
          {truncated && !open ? (
            <>
              {'…'}
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="ml-1 text-white/60 hover:text-[#71b7fb] hover:underline"
              >
                see more
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <div className="h-2" />
      )}

      {image ? (
        // LinkedIn shows the image as uploaded, at its own shape.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="max-h-[560px] w-full bg-black object-contain" />
      ) : null}

      <div className="mx-4 flex items-center justify-between border-b border-white/10 py-2 text-xs text-white/60">
        <span className="flex items-center gap-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#378fe9] text-white">
            <Icon className="h-2.5 w-2.5" strokeWidth={3}>
              <path d="M7 10v10M7 10l4-6.5c1.3 0 2.2 1 2 2.3L12.5 9H19" />
            </Icon>
          </span>
          Be the first to react
        </span>
      </div>
      <div className="grid grid-cols-4 px-2 py-1">
        {actions.map(({ label, icon }) => (
          <span
            key={label}
            className="flex items-center justify-center gap-1.5 rounded py-2.5 text-sm font-semibold text-white/60"
          >
            {icon}
            <span className="hidden sm:inline">{label}</span>
          </span>
        ))}
      </div>
    </article>
  );
}
