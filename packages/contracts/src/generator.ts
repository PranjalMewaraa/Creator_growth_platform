import type { ZodType } from 'zod';
import type { CreditEstimate, MeteringRates } from './credits';
import type { JobClass, JobStatus } from './jobs';

export const OUTPUT_TYPES = ['script', 'hook', 'caption', 'image', 'thumbnail', 'video'] as const;

export type OutputType = (typeof OUTPUT_TYPES)[number];

export const TARGET_PLATFORMS = ['instagram', 'linkedin'] as const;

export type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

export interface CanonicalRequest {
  workspaceId: string;
  intentText: string;
  templateId: string;
  templateVersion: number;
  outputType: OutputType;
  targetPlatform: TargetPlatform | null;
  profileVersion: number;
  brandKitVersion: number;
  /** Explicit user instructions from UI controls: duration, sceneCount, aspect, voice. */
  params?: Record<string, unknown>;
}

export interface CompiledPrompt {
  id: string;
  text: string;
  lineage: {
    intentText: string;
    templateVersion: number;
    profileVersion: number;
    brandKitVersion: number;
    compilerProfileVersion: number;
  };
  fallbackUsed: boolean;
  userEdited: boolean;
}

/** Adding a generator is a registry entry, never a change to API routing (FR-GN-02). */
export interface GeneratorDefinition<TInput> {
  key: string;
  outputType: OutputType;
  jobClass: Exclude<JobClass, 'publish'>;
  inputSchema: ZodType<TInput>;
  compilerProfile: string;
  providerAdapter: string;
  /** Prices against the versioned rates passed in, never constants in code (FR-BL-01). */
  estimate(input: TInput, rates: MeteringRates): CreditEstimate;
}

export interface GeneratorOutput {
  jobId: string;
  status: JobStatus;
  outputs: Array<{ kind: OutputType; storageKey: string; metadata: unknown }>;
  compiledPromptId: string;
  /** On BLOCKED, `category` is the moderation category shown to the user. */
  error?: { code: string; message: string; category?: string };
}
