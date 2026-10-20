'use client';

import type { GalleryOutput } from '@cgp/core';
import { useEffect, useState } from 'react';

const VISUAL: ReadonlySet<string> = new Set(['image', 'thumbnail']);

interface InspirationCard {
  id: string;
  kind: 'image' | 'video';
  url: string;
  intentText: string;
  aspectRatio: string;
  isSample?: boolean;
}

// Curated high-aesthetic cards matching the exact subjects & bento variety in reference Image 2
const INSPIRATION_CARDS: InspirationCard[] = [
  {
    id: 'insp-1',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=500&q=80',
    intentText: 'Futuristic cycling glasses portrait, ultra high fashion editorial, studio lighting, 8k',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-2',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=500&q=80',
    intentText: 'Editorial street style fashion in wide leg denim and tailored blazer, clean white backdrop',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-3',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=500&q=80',
    intentText: 'Woman walking through historic European cobblestone street, autumn trenchcoat, golden hour',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-4',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=500&q=80',
    intentText: 'Minimalist ceramic clay vessels in soft diffused studio lighting, warm beige tones',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-5',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=500&q=80',
    intentText: 'Woman relaxing on hardwood floor in navy sweater and cream trousers, natural window light',
    aspectRatio: 'aspect-[4/3]',
    isSample: true,
  },
  {
    id: 'insp-6',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=500&q=80',
    intentText: 'Man in navy polo and denim jeans seated in mid-century wooden armchair, editorial portrait',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-7',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=500&q=80',
    intentText: 'Long exposure motion blur portrait with tinted retro sunglasses, vibrant warm orange studio backdrop',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-8',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=500&q=80',
    intentText: 'Model walking through narrow European stone alley in black minimalist tee and pleated trousers',
    aspectRatio: 'aspect-[9/16]',
    isSample: true,
  },
  {
    id: 'insp-9',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=500&q=80',
    intentText: 'Skincare cosmetic serum pump bottle with pastel blue tone, clean modern aesthetic',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-10',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=500&q=80',
    intentText: 'Elderly man walking in New York city street with yellow headphone doodle illustration overlays',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-11',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=500&q=80',
    intentText: 'Woman holding yellow beauty cream tube against cheek, clean natural glow, neutral studio background',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-12',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&w=500&q=80',
    intentText: 'Beauty editorial of woman holding glass amber dropper bottle, warm lighting, glowing complexion',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-13',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=500&q=80',
    intentText: 'Athlete woman tying running shoes on outdoor tennis court at golden hour, sporty dynamic aesthetic',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-14',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=500&q=80',
    intentText: 'Close up of woman in white off-shoulder top with delicate gold coin necklace, sunlit terrace',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-15',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=500&q=80',
    intentText: 'Radiant beauty model smiling while holding blue skincare serum bottle, hoop earrings',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-16',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=500&q=80',
    intentText: 'Dramatic portrait of a man looking down wearing a ribbed knit beanie, chiaroscuro lighting',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-17',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=500&q=80',
    intentText: 'Man in green baseball cap and chunky cream knit sweater, striking red studio background',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-18',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1488161628813-04466f872be2?auto=format&fit=crop&w=500&q=80',
    intentText: 'Young man in brown corduroy bucket hat and matching canvas overshirt, moody studio portrait',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-19',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=500&q=80',
    intentText: 'Minimalist concrete solid cube on white infinite background, architectural brutalist study',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-20',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?auto=format&fit=crop&w=500&q=80',
    intentText: 'Driver with tattoo holding classic vintage car steering wheel wearing retro green cap, open country road',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-21',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=500&q=80',
    intentText: 'Woman in oversized black blazer and dark sunglasses, muted olive green background, high fashion',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-22',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?auto=format&fit=crop&w=500&q=80',
    intentText: 'Motorcyclist silhouette wearing vintage cream helmet against warm incandescent orange backlight',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-23',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?auto=format&fit=crop&w=500&q=80',
    intentText: 'Tight portrait of face wearing tortoiseshell glasses with yellow tinted lenses, editorial fashion',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-24',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=500&q=80',
    intentText: 'Macro view of neck wearing gold pendant medal necklace on crisp white open linen shirt',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-25',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1511447333015-45b65e60f6d5?auto=format&fit=crop&w=500&q=80',
    intentText: 'Morning skincare routine, woman with hair wrapped in towel smiling in modern bathroom mirror',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-26',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=500&q=80',
    intentText: 'Man in beige cashmere overcoat looking up in busy Manhattan street between skyscrapers',
    aspectRatio: 'aspect-[9/16]',
    isSample: true,
  },
  {
    id: 'insp-27',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=500&q=80',
    intentText: 'Model in metallic chrome wrap sunglasses, creative editorial double exposure and shadows',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-28',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1563089145-599997674d42?auto=format&fit=crop&w=500&q=80',
    intentText: 'Driver in retro baseball cap looking back while driving vintage automobile on desert highway',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-29',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=500&q=80',
    intentText: 'Model standing in underground subway corridor with leather duffel bag, streetwear look',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-30',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=500&q=80',
    intentText: 'Close up of road bicycle frame with neon yellow water bottle cage in mountain backdrop',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-31',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=500&q=80',
    intentText: 'Trail runner athlete ascending rocky mountain trail at sunrise, technical activewear',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-32',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=500&q=80',
    intentText: 'Cosmetic bottle with dispenser pump dispensing clear product in studio macro lighting',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
  {
    id: 'insp-33',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=500&q=80',
    intentText: 'Editorial close up portrait with dramatic red and amber lighting, intense gaze',
    aspectRatio: 'aspect-[3/4]',
    isSample: true,
  },
  {
    id: 'insp-34',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=500&q=80',
    intentText: 'Girl holding baseball cap covering eyes in beige sweater, minimalist warm beige portrait',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-35',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=500&q=80',
    intentText: 'Person in black sunglasses walking in empty European old town street between stone facades',
    aspectRatio: 'aspect-[4/5]',
    isSample: true,
  },
  {
    id: 'insp-36',
    kind: 'image',
    url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=500&q=80',
    intentText: 'Athlete resting on wooden bench beside running track holding pastel beverage can in sunlight',
    aspectRatio: 'aspect-[1/1]',
    isSample: true,
  },
];

export function GalleryFeed({
  workspaceId,
  onOpen,
  onUsePrompt,
}: {
  workspaceId: string;
  onOpen: (jobId: string) => void;
  onUsePrompt?: (prompt: string) => void;
}) {
  const [workspaceItems, setWorkspaceItems] = useState<GalleryOutput[] | null>(null);

  useEffect(() => {
    let stopped = false;
    void fetch(`/api/w/${workspaceId}/studio/feed`)
      .then((r) => (r.ok ? (r.json() as Promise<{ feed: GalleryOutput[] }>) : null))
      .then((body) => {
        if (stopped || !body) return;
        setWorkspaceItems(body.feed);
      })
      .catch(() => {
        if (!stopped) setWorkspaceItems([]);
      });
    return () => {
      stopped = true;
    };
  }, [workspaceId]);

  // Merge real workspace generations at the top, followed by inspiration cards to fill the bento grid
  const allCards: Array<{
    id: string;
    jobId?: string;
    kind: string;
    url?: string;
    text?: string;
    intentText: string;
    aspectRatio?: string;
    isWorkspace?: boolean;
  }> = [];

  if (workspaceItems && workspaceItems.length > 0) {
    for (const item of workspaceItems) {
      if (!item.media?.url) continue;
      allCards.push({
        id: item.id,
        jobId: item.jobId,
        kind: item.kind,
        url: item.media.url,
        text: item.text,
        intentText: item.intentText || item.text || 'Generated creation',
        aspectRatio: item.kind === 'video' ? 'aspect-[9/16]' : 'aspect-[3/4]',
        isWorkspace: true,
      });
    }
  }

  // Add inspiration cards so the grid is densely populated with cards in a Pinterest layout
  for (const insp of INSPIRATION_CARDS) {
    allCards.push({
      id: insp.id,
      kind: insp.kind,
      url: insp.url,
      intentText: insp.intentText,
      aspectRatio: insp.aspectRatio,
      isWorkspace: false,
    });
  }

  return (
    <div className="w-full">
      {/* 
        Pinterest Bento Masonry Layout:
        Dense columns (3 on mobile, 4-6 on tablet, 8 on laptop, 10-12 on desktop/ultrawide)
        Compact ~140px-170px cards with tight 8px-10px gaps
      */}
      <div className="columns-3 sm:columns-4 md:columns-6 lg:columns-8 xl:columns-9 2xl:columns-10 3xl:columns-12 gap-2 sm:gap-2.5">
        {allCards.map((card) => {
          const ratioClass = card.aspectRatio || 'aspect-[3/4]';

          return (
            <div
              key={card.id}
              onClick={() => {
                if (card.isWorkspace && card.jobId) {
                  onOpen(card.jobId);
                } else if (onUsePrompt) {
                  onUsePrompt(card.intentText);
                }
              }}
              className="group mb-2 sm:mb-2.5 block w-full cursor-pointer break-inside-avoid overflow-hidden rounded-[13px] border border-[#222329] bg-[#16171b] text-left transition-all duration-200 hover:border-[#383a44] hover:shadow-[0_12px_30px_rgba(0,0,0,0.85)] relative"
            >
              <div className={`relative w-full ${ratioClass} overflow-hidden bg-[#18191e]`}>
                {card.url ? (
                  card.kind === 'video' && card.isWorkspace ? (
                    <video
                      src={card.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="size-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={card.url}
                      alt={card.intentText}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.04]"
                    />
                  )
                ) : (
                  <div className="flex size-full flex-col justify-between p-3">
                    <p className="line-clamp-4 text-xs leading-5 text-muted">
                      {card.text || card.intentText}
                    </p>
                  </div>
                )}

                {/* Refined hover overlay matching reference image */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-2 flex flex-col justify-between select-none">
                  {/* Top-right action icons */}
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void navigator.clipboard?.writeText(card.intentText);
                      }}
                      title="Copy prompt"
                      className="size-5.5 rounded bg-black/60 hover:bg-black/90 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white transition-colors border border-white/10"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onUsePrompt) onUsePrompt(card.intentText);
                      }}
                      title="Use prompt"
                      className="size-5.5 rounded bg-black/60 hover:bg-black/90 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white transition-colors border border-white/10"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      title="Save / Bookmark"
                      className="size-5.5 rounded bg-black/60 hover:bg-black/90 backdrop-blur-md flex items-center justify-center text-white/80 hover:text-white transition-colors border border-white/10"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </button>
                  </div>

                  {/* Bottom prompt caption & action badges matching reference */}
                  <div className="flex flex-col gap-1.5">
                    <p className="line-clamp-2 text-[10px] font-light leading-snug text-white/95">
                      {card.intentText}
                    </p>
                    <div className="flex items-center gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-black/70 border border-white/10 backdrop-blur-md text-[8.5px] font-normal uppercase tracking-wider text-white/80">
                        {card.kind}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-white/20 hover:bg-white/30 backdrop-blur-md text-[9px] font-normal text-white transition-colors">
                        {card.isWorkspace ? 'Open Job' : 'Save to Assets'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
