'use client';

import {
  APERTURES,
  CAMERAS,
  FOCAL_LENGTHS,
  LENSES,
  LOOK_KEYS,
  LOOK_VOCABULARY,
  type LookKey,
  type TargetPlatform,
} from '@cgp/contracts';
import { useEffect, useRef, useState } from 'react';
import type { TemplateCard } from './template-picker';

// Icons matching the reference UI
function GenreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
  );
}

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

function MovementIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3" />
      <path d="M2 12h20M12 2v20" />
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

function UserIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function BookmarkIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
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

function WandIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 4-2 2M15 4l2 2M15 4v-2M15 4h2M2 22l10-10M20 9l-1 1M18 13l-1-1" />
    </svg>
  );
}

function StopwatchIconSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M10 2h4M12 2v3" />
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

  // Real Look controls
  look: Partial<Record<LookKey, string>>;
  onLookChange: (key: LookKey, value: string | undefined) => void;

  // Real Script controls
  platform: TargetPlatform | null;
  onPlatformChange: (p: TargetPlatform | null) => void;
  scriptLength: number | null;
  onScriptLengthChange: (len: number | null) => void;
  tone: string;
  onToneChange: (t: string) => void;
  profileTone: string | null;

  // Real Templates
  templates: TemplateCard[];
  selectedTemplateId: string | null;
  onSelectTemplate: (templateId: string | null) => void;
  onOpenTemplatesDialog: () => void;

  // Real Reference uploads
  referenceImages: Array<{ key: string; url: string }>;
  onUploadReference: (file: File) => void;
  onRemoveReference: (index: number) => void;
  referenceUploading: boolean;

  // Real Image controls
  aspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  count: number;
  onCountChange: (count: number) => void;
  imageModel: string;
  onImageModelChange: (model: string) => void;

  // Real Video controls
  videoModel: string;
  onVideoModelChange: (model: string) => void;
  videoDuration: number;
  onVideoDurationChange: (duration: number) => void;
  voiceover: boolean;
  onVoiceoverChange: (voiceover: boolean) => void;
  onStoryboardFirst?: () => void;

  // Extra Visual Presets
  genre: string;
  onGenreChange: (v: string) => void;
  style?: string;
  onStyleChange?: (v: string) => void;
  movement: string;
  onMovementChange: (v: string) => void;
  lighting: string;
  onLightingChange: (v: string) => void;
  resolution: string;
  onResolutionChange: (v: string) => void;
  batchMode: boolean;
  onBatchModeChange: (v: boolean) => void;
  cast: string;
  onCastChange: (v: string) => void;

  // Dialog openers & actions
  onOpenPromptDisclosure: () => void;
  onOpenKindsDialog: () => void;
  onOpenMoreDialog: () => void;
  onEnhancePrompt?: () => void;
}

const GENRE_OPTIONS = [
  'None',
  'Cinematic',
  'Anime',
  'Photorealistic',
  'Cyberpunk',
  'Fantasy',
  'Sci-Fi',
  'Vintage',
  'Minimalist',
  'Editorial',
  '3D Render',
  'Horror',
];

const LIGHTING_OPTIONS = [
  'None',
  'Golden Hour',
  'Dramatic',
  'Studio Soft',
  'Moody Neon',
  'Volumetric',
  'Rim Light',
  'Cinematic Backlight',
  'Natural Sunlight',
  'Cyberpunk Glow',
];

const MOVEMENT_OPTIONS = [
  'None',
  'Static',
  'Pan Left',
  'Pan Right',
  'Tilt Up',
  'Tilt Down',
  'Zoom In',
  'Zoom Out',
  'Tracking Shot',
  '360 Orbit',
  'Handheld Shake',
];

const SCRIPT_LENGTHS = [15, 30, 45, 60, 90];
const VIDEO_DURATIONS = [8, 16, 24, 32, 40, 48];
const ASPECT_RATIOS = ['', '1:1', '4:5', '9:16', '16:9'];
const RESOLUTION_OPTIONS = ['1K', '2K', '4K'];

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
  onStoryboardFirst,
  genre,
  onGenreChange,
  style = 'None',
  onStyleChange,
  movement,
  onMovementChange,
  lighting,
  onLightingChange,
  resolution,
  onResolutionChange,
  batchMode,
  onBatchModeChange,
  cast,
  onCastChange,
  onOpenPromptDisclosure,
  onOpenKindsDialog,
  onOpenMoreDialog,
  onEnhancePrompt,
}: ControlPanelProps) {
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleDropdown(name: string) {
    setActiveDropdown((prev) => (prev === name ? null : name));
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onUploadReference(file);
  }

  // Active Look labels from real contracts
  const activeCameraOption = CAMERAS.find((c) => c.id === look.camera);
  const cameraLabel = activeCameraOption ? activeCameraOption.label : 'Camera';

  const activeLensOption = LENSES.find((l) => l.id === look.lens);
  const lensLabel = activeLensOption ? activeLensOption.label : 'Lens';

  // Templates for current kind
  const activeKindTemplates = templates.filter((t) => {
    if (kind === 'script') return t.outputType === 'script';
    if (kind === 'image') return t.outputType === 'image' || t.outputType === 'thumbnail';
    if (kind === 'video') return t.outputType === 'video';
    return true;
  });
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  // Models
  const activeModel = kind === 'video' ? videoModel : imageModel;
  const currentModelLabel =
    kind === 'video'
      ? videoModel === 'gemini-omni-1.1-flash'
        ? 'Gemini Omni 1.1'
        : 'Veo 3.1 Lite'
      : imageModel === 'gemini-nano-banana-2-1'
        ? 'Nano Banana 2.1'
        : 'Nano Banana Pro';

  // Dynamic cost display
  let costDisplay = '$0.19';
  if (kind === 'video') {
    if (cost?.videoSeconds && cost.videoSeconds > 0) {
      costDisplay = `${cost.videoSeconds}s`;
    } else {
      costDisplay = `${videoDuration}s`;
    }
  } else if (cost?.credits !== undefined && cost !== null) {
    costDisplay = `${cost.credits} ${cost.credits === 1 ? 'credit' : 'credits'}`;
  } else {
    const multiplier = batchMode ? 0.5 : 1.0;
    costDisplay = `$${(0.19 * count * multiplier).toFixed(2)}`;
  }

  // Placeholder based on active kind
  const placeholder =
    kind === 'video'
      ? 'Describe the video you want to create…'
      : kind === 'image' || kind === 'thumbnail_set'
        ? 'Describe the image you want to create…'
        : 'Describe the script you want to create… e.g. Our cold brew now ships across Jaipur';

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

      {/* Main Left Content Column */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5 pl-1 pr-0.5">

        {/* Top Row: Context-Aware Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {kind === 'script' ? (
            /* Script Specific Top Controls */
            <>
              {/* Platform */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('scriptPlatform')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><GenreIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Platform</span>
                  <span className={`font-medium ${platform ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : 'Anywhere'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'scriptPlatform' && (
                  <div className="absolute bottom-full mb-1 left-0 z-50 min-w-36 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
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
                  </div>
                )}
              </div>

              {/* Script Length */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('scriptLength')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><MovementIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Length</span>
                  <span className={`font-medium ${scriptLength ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {scriptLength ? `${scriptLength}s` : 'Default'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'scriptLength' && (
                  <div className="absolute bottom-full mb-1 left-0 z-50 min-w-32 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
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
                  </div>
                )}
              </div>

              {/* Script Tone */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('scriptTone')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><LightingIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Tone</span>
                  <span className={`font-medium truncate max-w-28 ${tone ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {tone || profileTone || 'Default Tone'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'scriptTone' && (
                  <div className="absolute bottom-full mb-1 left-0 z-50 min-w-48 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                    {SCRIPT_TONES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          onToneChange(t === 'Default Profile Tone' ? '' : t);
                          setActiveDropdown(null);
                        }}
                        className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Script Template */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('scriptTemplate')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><StyleIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Template</span>
                  <span className={`font-medium truncate max-w-28 ${selectedTemplate ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {selectedTemplate ? selectedTemplate.title : 'Default'}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'scriptTemplate' && (
                  <div className="absolute bottom-full mb-1 left-0 z-50 max-h-56 w-52 overflow-y-auto rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl no-scrollbar">
                    <button
                      type="button"
                      onClick={() => { onSelectTemplate(null); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!selectedTemplateId ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      Default Script Template
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
                  </div>
                )}
              </div>

              {/* More settings dialog */}
              <button
                type="button"
                onClick={onOpenMoreDialog}
                className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px] text-[#7a7c87] hover:text-white"
              >
                More
              </button>
            </>
          ) : (
            /* Visual (Image & Video) Top Controls: Exact 5 Pills from UI */
            <>
              {/* 1. Genre */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('genre')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><GenreIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Genre</span>
                  <span className={`font-medium ${genre !== 'None' ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {genre}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'genre' && (
                  <DropdownList
                    options={GENRE_OPTIONS}
                    selected={genre}
                    onSelect={(val) => { onGenreChange(val); setActiveDropdown(null); }}
                  />
                )}
              </div>

              {/* 2. Style (Connected to real templates & styles) */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('style')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><StyleIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Style</span>
                  <span className={`font-medium truncate max-w-28 ${selectedTemplate ? 'text-white' : style !== 'None' ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {selectedTemplate ? selectedTemplate.title : style}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'style' && (
                  <div className="absolute bottom-full mb-1 left-0 z-50 max-h-56 w-52 overflow-y-auto rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl no-scrollbar">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTemplate(null);
                        onGenreChange('None');
                        setActiveDropdown(null);
                      }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!selectedTemplateId && style === 'None' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      None
                    </button>
                    {activeKindTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          onSelectTemplate(t.id);
                          setActiveDropdown(null);
                        }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${selectedTemplateId === t.id ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        {t.title}
                      </button>
                    ))}
                    <div className="border-t border-[#25262f] my-1" />
                    <button
                      type="button"
                      onClick={() => { onOpenTemplatesDialog(); setActiveDropdown(null); }}
                      className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[#2ef07a] hover:bg-[#1f2027]"
                    >
                      Browse all templates…
                    </button>
                  </div>
                )}
              </div>

              {/* 3. Lighting */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('lighting')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><LightingIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Lighting</span>
                  <span className={`font-medium ${lighting !== 'None' ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {lighting}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'lighting' && (
                  <DropdownList
                    options={LIGHTING_OPTIONS}
                    selected={lighting}
                    onSelect={(val) => { onLightingChange(val); setActiveDropdown(null); }}
                  />
                )}
              </div>

              {/* 4. Camera (Directly maps to look.camera in contracts) */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('camera')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><CameraLookIcon /></span>
                  <span className="text-[#7a7c87] font-medium">Camera</span>
                  <span className={`font-medium truncate max-w-28 ${look.camera ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {cameraLabel}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'camera' && (
                  <div className="absolute bottom-full mb-1 left-0 z-50 min-w-44 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                    <button
                      type="button"
                      onClick={() => { onLookChange('camera', undefined); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!look.camera ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      Camera (Default)
                    </button>
                    {CAMERAS.map((cam) => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => { onLookChange('camera', cam.id); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${look.camera === cam.id ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        {cam.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. Movement (for video) OR Lens (for image) */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleDropdown('movementOrLens')}
                  className="tap-target h-7 px-2.5 rounded-lg bg-[#1c1d22]/90 border border-[#282931] flex items-center gap-1.5 cursor-pointer hover:bg-[#23242b] hover:border-[#383944] transition-colors select-none text-[11px]"
                >
                  <span className="text-[#727480]"><MovementIcon /></span>
                  <span className="text-[#7a7c87] font-medium">{kind === 'video' ? 'Movement' : 'Lens'}</span>
                  <span className={`font-medium truncate max-w-28 ${(kind === 'video' ? movement !== 'None' : look.lens) ? 'text-white' : 'text-[#d4d4d8]'}`}>
                    {kind === 'video' ? movement : lensLabel}
                  </span>
                  <ChevronDownSmall />
                </button>
                {activeDropdown === 'movementOrLens' && (
                  kind === 'video' ? (
                    <DropdownList
                      options={MOVEMENT_OPTIONS}
                      selected={movement}
                      onSelect={(val) => { onMovementChange(val); setActiveDropdown(null); }}
                    />
                  ) : (
                    <div className="absolute bottom-full mb-1 left-0 z-50 min-w-44 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                      <button
                        type="button"
                        onClick={() => { onLookChange('lens', undefined); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${!look.lens ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        None
                      </button>
                      {LENSES.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          onClick={() => { onLookChange('lens', l.id); setActiveDropdown(null); }}
                          className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${look.lens === l.id ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            </>
          )}
        </div>

        {/* Middle Prompt Input Area */}
        <div className="flex items-center gap-3 my-1.5 min-h-[46px]">
          {/* Reference Image Button */}
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

            {/* Real uploaded reference thumbnails */}
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

          {/* Text input */}
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

          {/* Eye Icon Button for Full Prompt Disclosure */}
          <button
            type="button"
            onClick={onOpenPromptDisclosure}
            title="Inspect compiled prompt & rules"
            className="tap-target size-9 rounded-xl bg-[#1c1d22] border border-[#282931] flex items-center justify-center text-[#787a86] hover:text-white hover:border-[#383944] transition-colors shrink-0"
          >
            <EyeIconSmall />
          </button>
        </div>

        {/* Bottom Toolbar Row: Mode Switcher & Real Controls */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5">
          {/* Segmented Mode Switcher (Script, Image, Video) */}
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

          {/* More Kinds / Templates Button [ ⊞ ] */}
          <button
            type="button"
            onClick={onOpenKindsDialog}
            title="Browse all generators & templates"
            className="tap-target size-7 sm:size-7.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center justify-center text-[#787a86] hover:text-white hover:border-[#383944] transition-colors shrink-0"
          >
            <GridIconSmall />
          </button>

          {/* Cast / Profile Persona Selector */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => toggleDropdown('cast')}
              title="Cast / Character consistency"
              className={`tap-target h-7 sm:h-7.5 px-2.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1.5 text-xs font-medium transition-colors ${cast !== 'None' ? 'text-white border-[#383944]' : 'text-[#787a86] hover:text-[#e4e4e7]'
                }`}
            >
              <UserIconSmall />
              <span>Cast</span>
            </button>
            {activeDropdown === 'cast' && (
              <div className="absolute bottom-full mb-1 left-0 z-50 min-w-44 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                {['None', 'Default Profile', 'Brand Persona A', 'Actor Studio', '+ Custom Cast'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => { onCastChange(c); setActiveDropdown(null); }}
                    className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${cast === c ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Prompt Disclosure Bookmark [ 🔖 ] */}
          <button
            type="button"
            onClick={onOpenPromptDisclosure}
            title="Open compiled prompt disclosure & rules"
            className="tap-target size-7 sm:size-7.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center justify-center text-[#787a86] hover:text-white hover:border-[#383944] transition-colors shrink-0"
          >
            <BookmarkIconSmall />
          </button>

          {/* Model Selector (Real Image and Video Models) */}
          {kind !== 'script' && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => toggleDropdown('model')}
                className="tap-target h-7 sm:h-7.5 px-2.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1.5 text-xs font-medium text-[#e4e4e7] hover:border-[#383944] transition-colors cursor-pointer select-none"
              >
                <span className="size-2 rounded-full bg-[#22c55e] shadow-[0_0_8px_rgba(34,197,94,0.7)] shrink-0" />
                <span>{currentModelLabel}</span>
                <ChevronDownSmall />
              </button>
              {activeDropdown === 'model' && (
                <div className="absolute bottom-full mb-1 left-0 z-50 min-w-48 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
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
                        onClick={() => { onImageModelChange('gemini-flash-lite-image'); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${imageModel === 'gemini-flash-lite-image' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        <span>Nano Banana Pro (Lite)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { onImageModelChange('gemini-nano-banana-2-1'); setActiveDropdown(null); }}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${imageModel === 'gemini-nano-banana-2-1' ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                      >
                        <span>Nano Banana 2.1</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Aspect Ratio Selector (for Image) */}
          {kind === 'image' && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => toggleDropdown('ratio')}
                className="tap-target h-7 sm:h-7.5 px-2.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1.5 text-xs font-medium text-[#e4e4e7] hover:border-[#383944] transition-colors cursor-pointer select-none"
              >
                <AspectRatioIconSmall />
                <span>{aspectRatio || 'Platform decides'}</span>
                <ChevronDownSmall />
              </button>
              {activeDropdown === 'ratio' && (
                <div className="absolute bottom-full mb-1 left-0 z-50 min-w-36 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
                  {ASPECT_RATIOS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => { onAspectRatioChange(r); setActiveDropdown(null); }}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs ${aspectRatio === r ? 'bg-[#25262f] text-white font-medium' : 'text-[#a1a1aa] hover:bg-[#1f2027] hover:text-white'}`}
                    >
                      {r || 'Platform decides'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Duration (Video/Script) OR Resolution (Image) */}
          {kind === 'video' ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => toggleDropdown('videoDuration')}
                className="tap-target h-7 sm:h-7.5 px-2 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1 text-xs font-medium text-[#e4e4e7] hover:border-[#383944] transition-colors cursor-pointer select-none"
              >
                <span>{videoDuration}s</span>
                <ChevronDownSmall />
              </button>
              {activeDropdown === 'videoDuration' && (
                <div className="absolute bottom-full mb-1 left-0 z-50 min-w-28 rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl">
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
                </div>
              )}
            </div>
          ) : kind === 'image' ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => toggleDropdown('resolution')}
                className="tap-target h-7 sm:h-7.5 px-2 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center gap-1 text-xs font-medium text-[#e4e4e7] hover:border-[#383944] transition-colors cursor-pointer select-none"
              >
                <span>{resolution}</span>
                <ChevronDownSmall />
              </button>
              {activeDropdown === 'resolution' && (
                <DropdownList
                  options={RESOLUTION_OPTIONS}
                  selected={resolution}
                  onSelect={(val) => { onResolutionChange(val); setActiveDropdown(null); }}
                />
              )}
            </div>
          ) : null}

          {/* Count Stepper (Image) */}
          {kind === 'image' && (
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
          )}

          {/* Voiceover Toggle (Video) */}
          {kind === 'video' && (
            <button
              type="button"
              onClick={() => onVoiceoverChange(!voiceover)}
              title="Voiceover audio generation"
              className={`tap-target h-7 sm:h-7.5 px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-medium transition-all select-none shrink-0 ${voiceover
                ? 'border-[#bf00ff] bg-[#bf00ff]/15 text-white'
                : 'border-[#282931] bg-[#1c1d22] text-[#787a86] hover:text-white'
                }`}
            >
              <MicIconSmall />
              <span>Voiceover</span>
            </button>
          )}

          {/* Storyboard Button (Video) */}
          {kind === 'video' && onStoryboardFirst && (
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
          )}

          {/* Magic Wand / AI Prompt Enhancer */}
          <button
            type="button"
            onClick={() => {
              if (onEnhancePrompt) onEnhancePrompt();
              else onOpenPromptDisclosure();
            }}
            title="Enhance prompt with AI"
            className="tap-target size-7 sm:size-7.5 rounded-lg bg-[#1c1d22] border border-[#282931] flex items-center justify-center text-[#787a86] hover:text-white hover:border-[#383944] transition-colors shrink-0"
          >
            <WandIconSmall />
          </button>

          {/* Batch Discount Mode */}
          <button
            type="button"
            onClick={() => onBatchModeChange(!batchMode)}
            title="Toggle Batch Mode for 50% discount"
            className={`tap-target h-7 sm:h-7.5 px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-medium transition-all select-none shrink-0 ${batchMode
              ? 'bg-[#182a1f] border-[#22c55e]/50 text-white'
              : 'bg-[#1c1d22] border-[#282931] text-[#787a86] hover:text-[#e4e4e7]'
              }`}
          >
            <StopwatchIconSmall />
            <span>Batch</span>
            <span className="text-[#2ef07a] font-semibold text-[11px]">-50%</span>
          </button>
        </div>
      </div>

      {/* Right Giant Action Button: Generate / Write / Film */}
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

// Reusable Dropdown List
function DropdownList({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (option: string) => void;
}) {
  return (
    <div className="absolute bottom-full mb-1 left-0 z-50 max-h-56 w-44 overflow-y-auto rounded-xl border border-[#2d2e36] bg-[#16171b] p-1 shadow-2xl backdrop-blur-xl no-scrollbar">
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
    </div>
  );
}
