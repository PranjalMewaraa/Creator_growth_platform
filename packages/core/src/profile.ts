import { LANGUAGES, TARGET_PLATFORMS } from '@cgp/contracts';
import {
  createProfileVersion,
  listProfileVersions,
  type Database,
  type ProfileFields,
  type ProfileRow,
} from '@cgp/db';
import { z } from 'zod';
import type { InputIssue } from './generators/registry';

// The workspace profile (FR-ON, S-17): who is posting, where, how often, about what, in what
// voice. Every answer feeds the compiler, so each one visibly changes generated output.

/** Suggested answers. Free text is allowed too; these are starting points, not a closed list. */
export const PROFILE_OPTIONS = {
  contentTypes: ['Short video', 'Carousel', 'Single image', 'Text post', 'Stories', 'Long video'],
  teamShapes: ['Solo creator', 'Creator with an editor', 'Small team', 'Brand or business'],
  cadences: ['1 post a week', '3 posts a week', '5 posts a week', 'Every day'],
  tones: [
    'Warm, direct, practical',
    'Playful and witty',
    'Calm and expert',
    'Bold and energetic',
    'Honest and personal',
  ],
} as const;

const phrase = (max: number) => z.string().trim().min(1).max(max);
const tags = (max: number, each: number) =>
  z
    .array(phrase(each))
    .max(max)
    .transform((list) => [...new Set(list)]);

export const profileSchema = z.object({
  contentTypes: tags(6, 40).pipe(z.array(z.string()).min(1, 'Pick at least one kind of content')),
  platforms: z.array(z.enum(TARGET_PLATFORMS)).min(1, 'Pick at least one platform'),
  teamShape: phrase(60),
  goal90d: phrase(200),
  cadence: phrase(60),
  pillars: tags(5, 40).pipe(z.array(z.string()).min(1, 'Add at least one content pillar')),
  tone: phrase(80),
  prohibitedWords: tags(30, 30).default([]),
  language: z.enum(LANGUAGES).default('en'),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/** The fields as a person reads them, for the version history. */
export const PROFILE_LABELS: Record<keyof ProfileInput, string> = {
  contentTypes: 'Content types',
  platforms: 'Platforms',
  teamShape: 'Who is posting',
  goal90d: '90 day goal',
  cadence: 'Cadence',
  pillars: 'Content pillars',
  tone: 'Tone',
  prohibitedWords: 'Words to avoid',
  language: 'Language',
};

const FIELDS = Object.keys(PROFILE_LABELS) as Array<keyof ProfileInput>;

function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Which fields differ between two versions, as labels. */
export function changedFields(
  before: Partial<ProfileFields> | undefined,
  after: Partial<ProfileFields>,
): string[] {
  if (!before) return ['First version'];
  return FIELDS.filter((field) => !same(before[field], after[field])).map(
    (field) => PROFILE_LABELS[field],
  );
}

export type SaveProfileResult =
  | { ok: true; profile: ProfileRow; changed: boolean }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] };

/**
 * Saves the profile as version N+1. Saving what is already there makes no version, so the
 * history only records real corrections, and lineage never points at a duplicate.
 */
export async function saveProfile(
  db: Database,
  workspaceId: string,
  raw: unknown,
): Promise<SaveProfileResult> {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }
  const [latest] = await listProfileVersions(db, workspaceId, 1);
  if (latest && changedFields(latest, parsed.data).length === 0) {
    return { ok: true, profile: latest, changed: false };
  }
  const profile = await createProfileVersion(db, workspaceId, parsed.data);
  return { ok: true, profile, changed: true };
}

export interface ProfileVersionView {
  version: number;
  createdAt: string;
  changes: string[];
  profile: ProfileInput;
}

function toInput(row: ProfileRow): ProfileInput {
  return {
    contentTypes: row.contentTypes,
    platforms: row.platforms.filter((p): p is ProfileInput['platforms'][number] =>
      (TARGET_PLATFORMS as readonly string[]).includes(p),
    ),
    teamShape: row.teamShape ?? '',
    goal90d: row.goal90d ?? '',
    cadence: row.cadence ?? '',
    pillars: row.pillars,
    tone: row.tone ?? '',
    prohibitedWords: row.prohibitedWords,
    language: (LANGUAGES as readonly string[]).includes(row.language)
      ? (row.language as ProfileInput['language'])
      : 'en',
  };
}

/** The history newest first, each version with what it changed from the one before. */
export async function profileHistory(
  db: Database,
  workspaceId: string,
): Promise<ProfileVersionView[]> {
  const rows = await listProfileVersions(db, workspaceId, 20);
  return rows.map((row, i) => ({
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    changes: changedFields(rows[i + 1], row),
    profile: toInput(row),
  }));
}
