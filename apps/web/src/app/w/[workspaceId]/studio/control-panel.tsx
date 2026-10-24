'use client';

import { LOOK_KEYS, LOOK_VOCABULARY, type LookKey, type TargetPlatform } from '@cgp/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { TemplateCard } from './template-picker';

// Every control in this bar maps to a real field the backend reads — no decorative chip that
// mutates nothing (WP66). A control that only exists to look full belongs in a mockup, not a
// product people spend credits through.

function StyleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.5 17.5 2 12 2z" />
    </svg>
  );
}

function LightingIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function CameraLookIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function ChevronDownSmall() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ScriptIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function ImageIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

function VideoIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 8-6 4 6 4V8Z" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function ThumbnailIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="14" rx="2" />
      <path d="M12.5 7.5 11 9.8h2.3L11.8 12" strokeWidth="1.6" />
    </svg>
  );
}

function GridIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function EyeIconSmall() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function AspectRatioIconSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function MicIconSmall() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5v3.3M9 20.8h6" />
    </svg>
  );
}

function SparkleStarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0L14.7 9.3L24 12L14.7 14.7L12 24L9.3 14.7L0 12L9.3 9.3L12 0Z" />
    </svg>
  );
}

/**
 * A dropdown's menu, portaled to the document body (WP66 bugfix): every trigger in this bar
 * sits inside a horizontally-scrolling row (`overflow-x-auto`), and per the CSS overflow spec
 * that also clips the *vertical* axis — so a plain `position: absolute` panel popping up via
 * `bottom-full` was rendering, fully styled, completely invisible, clipped by its own row
 * before it ever reached the screen. Escaping to the body via a portal, positioned with fixed
 * coordinates computed from the trigger's own rect, sidesteps that clipping entirely.
 */
function Panel({
  anchor,
  className,
  children,
}: {
  anchor: DOMRect;
  className?: string;
  children: ReactNode;
}) {
  return createPortal(
    <div
      data-chip-panel
      style={{
        position: 'fixed',
        left: anchor.left,
        bottom: Math.max(8, window.innerHeight - anchor.top + 4),
        zIndex: 9999,
      }}
      className={
        className ??
        'min-w-44 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl'
      }
    >
      {children}
    </div>,
    document.body,
  );
}

export interface ControlPanelProps {
  kind: string;
  onKindChange: (kind: string) => void;
  intent: string;
  onIntentChange: (intent: string) => void;
  onGenerate: (as?: string) => void;
  busy: 'compiling' | 'starting' | null;
  canGo: boolean;
  cost: { credits: number; videoSeconds: number } | null;
  storyboardCost: number | null;
  storyboardId: string | null;
  videoSecondsBalance: number;

  look: Partial<Record<LookKey, string>>;
  onLookChange: (key: LookKey, value: string | undefined) => void;

  platform: TargetPlatform | null;
  onPlatformChange: (p: TargetPlatform | null) => void;
  scriptLength: number | null;
  onScriptLengthChange: (len: number | null) => void;
  tone: string;
  onToneChange: (t: string) => void;
  profileTone: string | null;

  templates: TemplateCard[];
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string | null) => void;
  onOpenTemplatesDialog: () => void;

  referenceImages: Array<{ key: string; url: string }>;
  onUploadReference: (file: File) => void;
  onRemoveReference: (index: number) => void;
  referenceUploading: boolean;

  aspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  count: number;
  onCountChange: (count: number) => void;
  imageModel: string;
  onImageModelChange: (model: string) => void;

  videoModel: string;
  onVideoModelChange: (model: string) => void;
  videoDuration: number;
  onVideoDurationChange: (duration: number) => void;
  voiceover: boolean;
  onVoiceoverChange: (voiceover: boolean) => void;
  refine: boolean;
  onRefineChange: (refine: boolean) => void;
  onStoryboardFirst?: () => void;

  onOpenPromptDisclosure: () => void;
  onOpenKindsDialog: () => void;
  onOpenMoreDialog: () => void;
}

const LOOK_LABELS: Record<LookKey, string> = {
  camera: 'Camera',
  lens: 'Lens',
  focalLength: 'Focal length',
  aperture: 'Aperture',
};

const SCRIPT_LENGTHS = [15, 30, 45, 60, 90];
const VIDEO_DURATIONS = [8, 16, 24, 32, 40, 48];
// Image draws any of these four (packages/core/src/generators/definitions.ts); video only
// ever films vertical or landscape — that's what the real models and the render pipeline
// support (packages/core/src/render/reel.ts), so its own list stays shorter (WP66).
const IMAGE_ASPECT_RATIOS = ['', '1:1', '4:5', '9:16', '16:9'];
const VIDEO_ASPECT_RATIOS = ['', '9:16', '16:9'];

const SCRIPT_TONES = [
  'Default Profile Tone',
  'Energetic & Punchy',
  'Educational & Clear',
  'Story-driven & Cinematic',
  'Casual & Friendly',
  'Bold & Opinionated',
];

export function ControlPanel({
  kind,
  onKindChange,
  intent,
  onIntentChange,
  onGenerate,
  busy,
  canGo,
  cost,
  storyboardCost,
  storyboardId,
  videoSecondsBalance,
  look,
  onLookChange,
  platform,
  onPlatformChange,
  scriptLength,
  onScriptLengthChange,
  tone,
  onToneChange,
  profileTone,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onOpenTemplatesDialog,
  referenceImages,
  onUploadReference,
  onRemoveReference,
  referenceUploading,
  aspectRatio,
  onAspectRatioChange,
  count,
  onCountChange,
  imageModel,
  onImageModelChange,
  videoModel,
  onVideoModelChange,
  videoDuration,
  onVideoDurationChange,
  voiceover,
  onVoiceoverChange,
  refine,
  onRefineChange,
  onStoryboardFirst,
  onOpenPromptDisclosure,
  onOpenKindsDialog,
  onOpenMoreDialog,
}: ControlPanelProps) {
  const [activeDropdown, setActiveDropdown] = useState<{ name: string; rect: DOMRect } | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      // A click inside the portaled panel itself isn't "outside" even though it lives outside
      // containerRef in the DOM now (that's the whole point of the portal).
      if ((target as Element).closest?.('[data-chip-panel]')) return;
      if (containerRef.current && !containerRef.current.contains(target)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleDropdown(name: string, trigger: HTMLElement) {
    setActiveDropdown((prev) =>
      prev?.name === name ? null : { name, rect: trigger.getBoundingClientRect() },
    );
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onUploadReference(file);
  }

  function lookLabel(key: LookKey): string {
    const option = LOOK_VOCABULARY[key].find((o) => o.id === look[key]);
    return option ? option.label : LOOK_LABELS[key];
  }

  const activeKindTemplates = templates.filter((t) => {
    if (kind === 'script') return t.outputType === 'script';
    if (kind === 'image') return t.outputType === 'image' || t.outputType === 'thumbnail';
    if (kind === 'video') return t.outputType === 'video';
    return true;
  });
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const currentModelLabel =
    kind === 'video'
      ? videoModel === 'gemini-omni-1.1-flash'
        ? 'Gemini Omni 1.1'
        : 'Veo 3.1 Lite'
      : imageModel === 'gemini-3-pro-image'
        ? 'Nano Banana Pro'
        : imageModel === 'gemini-nano-banana-2-1'
          ? 'Nano Banana 2.1'
          : 'Nano Banana 2 Lite';

  // Honest, not a placeholder dollar figure: nothing is shown until the server has actually
  // priced this request (WP66) — the debounced /estimate call studio.tsx already makes.
  const costDisplay =
    kind === 'video'
      ? cost?.videoSeconds
        ? `${cost.videoSeconds}s`
        : '—'
      : cost
        ? `${cost.credits} ${cost.credits === 1 ? 'credit' : 'credits'}`
        : '—';

  const placeholder =
    kind === 'video'
      ? 'Describe the video you want to create…'
      : kind === 'thumbnail_set'
        ? 'Describe the thumbnail — who’s in it, the reaction, what it’s about…'
        : kind === 'image'
          ? 'Describe the image you want to create…'
          : 'Describe the script you want to create… e.g. Our cold brew now ships across Jaipur';

  const visual = kind === 'image' || kind === 'thumbnail_set' || kind === 'video';
  const aspectRatioOptions = kind === 'video' ? VIDEO_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS;

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-[1024px] rounded-[22px] border border-[#27282f] bg-[#131416]/95 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur-xl flex flex-row items-stretch gap-2.5 transition-all duration-200"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileSelect}
      />

      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5 pl-1 pr-0.5">
        {/* Top row: Template, then the real fields for this kind. */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {kind === 'script' ? (
            <>
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={(e) => toggleDropdown('scriptPlatform', e.currentTarget)}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#7a7c87] font-medium">Platform</span>
                  <span className={`font-medium ${platform ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Anywhere'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown?.name === 'scriptPlatform' ? (
                  <Panel anchor={activeDropdown.rect} className="min-w-36 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => { onPlatformChange(null); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!platform ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      Anywhere
                    </button>
                    <button
                      type="button"
                      onClick={() => { onPlatformChange('instagram'); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${platform === 'instagram' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      Instagram
                    </button>
                    <button
                      type="button"
                      onClick={() => { onPlatformChange('linkedin'); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${platform === 'linkedin' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      LinkedIn
                    </button>
                  </Panel>
                ) : null}
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={(e) => toggleDropdown('scriptLength', e.currentTarget)}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#7a7c87] font-medium">Length</span>
                  <span className={`font-medium ${scriptLength ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {scriptLength ? `${scriptLength}s` : 'Default'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown?.name === 'scriptLength' ? (
                  <Panel anchor={activeDropdown.rect} className="min-w-32 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => { onScriptLengthChange(null); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${scriptLength === null ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      Default
                    </button>
                    {SCRIPT_LENGTHS.map((len) => (
                      <button
                        key={len}
                        type="button"
                        onClick={() => { onScriptLengthChange(len); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${scriptLength === len ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        {len}s
                      </button>
                    ))}
                  </Panel>
                ) : null}
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={(e) => toggleDropdown('scriptTone', e.currentTarget)}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#7a7c87] font-medium">Tone</span>
                  <span className={`font-medium truncate max-w-28 ${tone ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {tone || profileTone || 'Default Tone'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown?.name === 'scriptTone' ? (
                  <DropdownList
                    anchor={activeDropdown.rect}
                    options={SCRIPT_TONES}
                    selected={tone || 'Default Profile Tone'}
                    onSelect={(t) => {
                      onToneChange(t === 'Default Profile Tone' ? '' : t);
                      setActiveDropdown(null);
                    }}
                  />
                ) : null}
              </div>

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={(e) => toggleDropdown('scriptTemplate', e.currentTarget)}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><StyleIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Template</span>
                  <span className={`font-medium truncate max-w-28 ${selectedTemplate ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {selectedTemplate ? selectedTemplate.title : 'Default'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown?.name === 'scriptTemplate' ? (
                  <Panel anchor={activeDropdown.rect} className="max-h-56 w-52 overflow-y-auto rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl no-scrollbar">
                    <button
                      type="button"
                      onClick={() => { onSelectTemplate(null); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!selectedTemplateId ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      Default
                    </button>
                    {activeKindTemplates.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => { onSelectTemplate(tmpl.id); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${selectedTemplateId === tmpl.id ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        {tmpl.title}
                      </button>
                    ))}
                  </Panel>
                ) : null}
              </div>

              <button
                type="button"
                onClick={onOpenMoreDialog}
                className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px] text-[#7a7c87] hover:text-white"
              >
                More
              </button>
            </>
          ) : (
            <>
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={(e) => toggleDropdown('template', e.currentTarget)}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><StyleIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Template</span>
                  <span className={`font-medium truncate max-w-28 ${selectedTemplate ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {selectedTemplate ? selectedTemplate.title : 'Default'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown?.name === 'template' ? (
                  <Panel anchor={activeDropdown.rect} className="max-h-56 w-52 overflow-y-auto rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl no-scrollbar">
                    <button
                      type="button"
                      onClick={() => { onSelectTemplate(null); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!selectedTemplateId ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      Default
                    </button>
                    {activeKindTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { onSelectTemplate(t.id); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${selectedTemplateId === t.id ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        {t.title}
                      </button>
                    ))}
                    <div className="border-t border-[#25262f] my-1" />
                    <button
                      type="button"
                      onClick={() => { onOpenTemplatesDialog(); setActiveDropdown(null); }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-accent hover:bg-[#1f2027]"
                    >
                      Browse all templates…
                    </button>
                  </Panel>
                ) : null}
              </div>

              {/* The real look (WP37/66): every visual kind, image or video, reads all four
                  of these from the compiler the same way — nothing here is kind-specific. */}
              {LOOK_KEYS.map((key) => (
                <div key={key} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={(e) => toggleDropdown(`look-${key}`, e.currentTarget)}
                    className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                  >
                    <span className="text-[#727480]"><CameraLookIcon /></span>
                    <span className="text-[#7a7c87] font-medium">{LOOK_LABELS[key]}</span>
                    <span className={`font-medium truncate max-w-28 ${look[key] ? 'text-white' : 'text-[#d4d4d8]'}`}>
                      {look[key] ? lookLabel(key) : 'Template decides'}
                    </span>
                    <ChevronDownSmall />
                  </button>
                  {activeDropdown?.name === `look-${key}` ? (
                    <Panel anchor={activeDropdown.rect} className="min-w-44 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                      <button
                        type="button"
                        onClick={() => { onLookChange(key, undefined); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!look[key] ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        Template decides
                      </button>
                      {LOOK_VOCABULARY[key].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => { onLookChange(key, option.id); setActiveDropdown(null); }}
                          className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${look[key] === option.id ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </Panel>
                  ) : null}
                </div>
              ))}

              <button
                type="button"
                onClick={onOpenMoreDialog}
                className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px] text-[#7a7c87] hover:text-white"
              >
                More
              </button>
            </>
          )}
        </div>

        {/* The prompt. */}
        <div className="flex items-center gap-3 my-1.5 min-h-[46px]">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={referenceUploading || referenceImages.length >= 3}
              title="Add reference image"
              className="tap-target size-10 sm:size-11 rounded-xl bg-[#1c1d22] border border-[#282931] flex items-center justify-center cursor-pointer hover:bg-[#24252d] hover:border-[#383946] text-[#71737e] hover:text-[#f4f4f5] transition-all disabled:opacity-40 disabled:cursor-not-allowed group"
            >
              {referenceUploading ? (
                <span className="text-xs animate-pulse text-[#22c55e]">...</span>
              ) : (
                <PlusIcon />
              )}
            </button>

            {referenceImages.map((ref, idx) => (
              <div
                key={ref.key}
                className="group relative size-10 sm:size-11 rounded-xl overflow-hidden border border-[#2c2d36] shrink-0"
              >
                <img src={ref.url} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveReference(idx)}
                  className="absolute inset-0 bg-black/70 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold"
                  title="Remove image"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <input
            id="studio-intent"
            value={intent}
            onChange={(e) => onIntentChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canGo) onGenerate();
              }
            }}
            maxLength={2000}
            placeholder={placeholder}
            className="flex-1 min-w-0 bg-transparent text-[14px] sm:text-[15px] text-[#f4f4f5] placeholder:text-[#52545f] outline-none border-none py-1.5 focus:ring-0 leading-relaxed font-normal"
          />

          <button
            type="button"
            onClick={onOpenPromptDisclosure}
            title="Inspect compiled prompt & rules"
            className="tap-target size-9 rounded-xl bg-[#1c1d22] border border-[#282931] flex items-center justify-center text-[#787a86] hover:text-white hover:border-[#383944] transition-colors shrink-0"
          >
            <EyeIconSmall />
          </button>
        </div>

        {/* Toolbar: what it's made with. */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          <div className="flex items-center rounded-lg bg-[#18191e] border border-[#26272f] p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onKindChange('script')}
              className={`tap-target px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${kind === 'script'
                ? 'bg-[#2c2d36] text-white shadow-sm'
                : 'text-[#787a86] hover:text-[#e4e4e7]'
                }`}
            >
              <ScriptIconSmall />
              <span>Script</span>
            </button>
            <button
              type="button"
              onClick={() => onKindChange('image')}
              className={`tap-target px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${kind === 'image'
                ? 'bg-[#2c2d36] text-white shadow-sm'
                : 'text-[#787a86] hover:text-[#e4e4e7]'
                }`}
            >
              <ImageIconSmall />
              <span>Image</span>
            </button>
            <button
              type="button"
              onClick={() => onKindChange('thumbnail_set')}
              className={`tap-target px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${kind === 'thumbnail_set'
                ? 'bg-[#2c2d36] text-white shadow-sm'
                : 'text-[#787a86] hover:text-[#e4e4e7]'
                }`}
            >
              <ThumbnailIconSmall />
              <span>Thumbnail</span>
            </button>
            <button
              type="button"
              onClick={() => onKindChange('video')}
              className={`tap-target px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all ${kind === 'video'
                ? 'bg-[#2c2d36] text-white shadow-sm'
                : 'text-[#787a86] hover:text-[#e4e4e7]'
                }`}
            >
              <VideoIconSmall />
              <span>Video</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenKindsDialog}
            title="Browse all generators & templates"
            className="tap-target size-7 sm:size-7.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center justify-center text-[#787a86] hover:text-white hover:border-[#383944] transition-colors shrink-0"
          >
            <GridIconSmall />
          </button>

          {visual ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => toggleDropdown('model', e.currentTarget)}
                className="tap-target h-7 sm:h-7.5 px-2.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1.5 text-xs font-medium text-[#e4e4e7] hover:border-[#383944] transition-colors cursor-pointer select-none"
              >
                <span className="size-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.7)] shrink-0" />
                <span>{currentModelLabel}</span>
                <ChevronDownSmall />
              </button>
              {activeDropdown?.name === 'model' ? (
                <Panel anchor={activeDropdown.rect} className="min-w-48 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                  {kind === 'video' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => { onVideoModelChange('veo-3.1-lite'); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${videoModel === 'veo-3.1-lite' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        <span>Veo 3.1 Lite (current)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { onVideoModelChange('gemini-omni-1.1-flash'); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${videoModel === 'gemini-omni-1.1-flash' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        <span>Gemini Omni 1.1 Flash</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { onImageModelChange('gemini-3-pro-image'); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${imageModel === 'gemini-3-pro-image' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        <span>Nano Banana Pro</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { onImageModelChange('gemini-nano-banana-2-1'); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${imageModel === 'gemini-nano-banana-2-1' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        <span>Nano Banana 2.1</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { onImageModelChange('gemini-flash-lite-image'); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${imageModel === 'gemini-flash-lite-image' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        <span>Nano Banana 2 Lite</span>
                      </button>
                    </>
                  )}
                </Panel>
              ) : null}
            </div>
          ) : null}

          {/* Aspect ratio, for image and video alike — each offers the shapes its own render
              path can actually produce (WP66). */}
          {kind === 'image' || kind === 'video' ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => toggleDropdown('ratio', e.currentTarget)}
                className="tap-target h-7 sm:h-7.5 px-2.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1.5 text-xs font-medium text-[#e4e4e7] hover:border-[#383944] transition-colors cursor-pointer select-none"
              >
                <AspectRatioIconSmall />
                <span>{aspectRatio || 'Platform decides'}</span>
                <ChevronDownSmall />
              </button>
              {activeDropdown?.name === 'ratio' ? (
                <Panel anchor={activeDropdown.rect} className="min-w-36 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                  {aspectRatioOptions.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { onAspectRatioChange(r); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${aspectRatio === r ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      {r || 'Platform decides'}
                    </button>
                  ))}
                </Panel>
              ) : null}
            </div>
          ) : null}

          {kind === 'video' ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={(e) => toggleDropdown('videoDuration', e.currentTarget)}
                className="tap-target h-7 sm:h-7.5 px-2 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1 text-xs font-medium text-[#e4e4e7] hover:border-[#383944] transition-colors cursor-pointer select-none"
              >
                <span>{videoDuration}s</span>
                <ChevronDownSmall />
              </button>
              {activeDropdown?.name === 'videoDuration' ? (
                <Panel anchor={activeDropdown.rect} className="min-w-28 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                  {VIDEO_DURATIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { onVideoDurationChange(d); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${videoDuration === d ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      {d}s
                    </button>
                  ))}
                </Panel>
              ) : null}
            </div>
          ) : null}

          {kind === 'image' ? (
            <div className="h-7 sm:h-7.5 px-1.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1 text-xs font-medium text-[#e4e4e7] shrink-0 select-none">
              <button
                type="button"
                onClick={() => onCountChange(Math.max(1, count - 1))}
                disabled={count <= 1}
                className="px-1 text-[#787a86] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed font-bold"
              >
                -
              </button>
              <span className="tabular-nums px-0.5 font-medium">{count}/4</span>
              <button
                type="button"
                onClick={() => onCountChange(Math.min(4, count + 1))}
                disabled={count >= 4}
                className="px-1 text-[#787a86] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed font-bold"
              >
                +
              </button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => onRefineChange(!refine)}
            title={
              refine
                ? 'Polishes the brief before generating. Off: what you typed is sent as is.'
                : 'Sending exactly what you typed, unpolished.'
            }
            className={`tap-target h-7 sm:h-7.5 px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-medium transition-all select-none shrink-0 ${refine
              ? 'border-accent bg-accent/15 text-white'
              : 'border-[#282931] bg-[#1c1d22] text-[#787a86] hover:text-white'
              }`}
          >
            <span>{refine ? 'Refine prompt' : 'Refine off'}</span>
          </button>

          {kind === 'video' ? (
            <button
              type="button"
              onClick={() => onVoiceoverChange(!voiceover)}
              title="Voiceover audio generation"
              className={`tap-target h-7 sm:h-7.5 px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-medium transition-all select-none shrink-0 ${voiceover
                ? 'border-accent bg-accent/15 text-white'
                : 'border-[#282931] bg-[#1c1d22] text-[#787a86] hover:text-white'
                }`}
            >
              <MicIconSmall />
              <span>Voiceover</span>
            </button>
          ) : null}

          {kind === 'video' && onStoryboardFirst ? (
            <button
              type="button"
              onClick={onStoryboardFirst}
              disabled={busy === 'starting' || !canGo}
              title="Generate a multi-scene storyboard first"
              className="tap-target h-7 sm:h-7.5 px-2.5 rounded-lg border border-[#282931] bg-[#1c1d22] hover:bg-[#25262f] text-[#d4d4d8] hover:text-white flex items-center gap-1.5 text-xs font-medium transition-colors shrink-0 disabled:opacity-40"
            >
              <span>Storyboard</span>
              {storyboardCost !== null && <span className="text-[#a1a1aa] font-mono text-[10px]">({storyboardCost}c)</span>}
            </button>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onGenerate()}
        disabled={
          !canGo ||
          busy !== null ||
          (kind === 'video' && videoSecondsBalance < (cost?.videoSeconds ?? 0))
        }
        className="w-24 sm:w-28 flex flex-col items-center justify-center gap-0.5 rounded-2xl bg-[#2ef07a] hover:bg-[#28dd6f] active:bg-[#22c75f] text-black font-semibold cursor-pointer select-none transition-all duration-150 shadow-[0_4px_22px_rgba(46,240,122,0.38)] shrink-0 self-stretch disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        <span className="text-black mb-0.5">
          {busy !== null ? (
            <span className="inline-block animate-spin text-sm">⟳</span>
          ) : (
            <SparkleStarIcon />
          )}
        </span>
        <span className="text-[13px] sm:text-sm font-bold tracking-tight text-black leading-tight">
          {busy === 'starting'
            ? 'Starting…'
            : busy === 'compiling'
              ? 'Compiling…'
              : kind === 'script'
                ? 'Write'
                : kind === 'video'
                  ? storyboardId
                    ? 'Film Story'
                    : 'Film'
                  : 'Generate'}
        </span>
        <span className="text-[11px] font-semibold text-black/80 font-mono tabular-nums leading-tight">
          {costDisplay}
        </span>
      </button>
    </div>
  );
}

function DropdownList({
  anchor,
  options,
  selected,
  onSelect,
}: {
  anchor: DOMRect;
  options: string[];
  selected: string;
  onSelect: (option: string) => void;
}) {
  return (
    <Panel anchor={anchor} className="max-h-56 w-44 overflow-y-auto rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl no-scrollbar">
      {options.map((option) => {
        const isSelected = selected === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors flex items-center justify-between ${isSelected
              ? 'bg-[#25262f] text-white font-medium'
              : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'
              }`}
          >
            <span>{option}</span>
            {isSelected && <span className="text-[#22c55e]">✓</span>}
          </button>
        );
      })}
    </Panel>
  );
}
