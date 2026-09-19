import { randomUUID } from 'node:crypto';
import type { Logger } from '@cgp/config';
import type { ModerationAdapter, ModerationCategory, ObjectStore } from '@cgp/contracts';
import {
  createBrandKitVersion,
  listBrandKitVersions,
  type BrandKitRow,
  type Database,
} from '@cgp/db';
import sharp from 'sharp';
import { z } from 'zod';
import type { InputIssue } from './generators/registry';

// The brand kit (S-18): logo, up to three colours, a typeface and a tagline. The compiler
// writes the colours and tagline into briefs, and the Instagram copy uses the first colour
// for its bars.

/**
 * Typefaces the renderer has installed (infra/render-box/fonts), so text laid over images and
 * video uses exactly the face chosen here.
 */
export const BRAND_FONTS = ['Poppins', 'Noto Sans Devanagari'] as const;

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_SIZE = 512;

const HEX = /^#[0-9a-f]{6}$/i;

export const brandKitSchema = z.object({
  /** A logo stored by storeLogo for this workspace, or none. */
  logoUrl: z.url().nullable().default(null),
  colors: z
    .array(z.string().regex(HEX, 'Colours are six digit hex, like #1F2937'))
    .min(1, 'Pick at least one colour')
    .max(3, 'Three colours at most')
    .transform((list) => [...new Set(list.map((c) => c.toUpperCase()))]),
  typography: z.enum(BRAND_FONTS),
  tagline: z.string().trim().max(80).default(''),
});

export type BrandKitInput = z.infer<typeof brandKitSchema>;

export const BRAND_KIT_LABELS: Record<keyof BrandKitInput, string> = {
  logoUrl: 'Logo',
  colors: 'Colours',
  typography: 'Typography',
  tagline: 'Tagline',
};

function toInput(row: BrandKitRow): BrandKitInput {
  return {
    logoUrl: row.logoUrl,
    colors: row.colors.map((c) => c.toUpperCase()),
    typography: (BRAND_FONTS as readonly string[]).includes(row.typography ?? '')
      ? (row.typography as BrandKitInput['typography'])
      : 'Poppins',
    tagline: row.tagline ?? '',
  };
}

function changed(before: BrandKitInput | undefined, after: BrandKitInput): string[] {
  if (!before) return ['First version'];
  return (Object.keys(BRAND_KIT_LABELS) as Array<keyof BrandKitInput>)
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => BRAND_KIT_LABELS[key]);
}

export type SaveBrandKitResult =
  | { ok: true; version: number; changed: boolean }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] };

/**
 * Saves version N+1 when anything changed. A logo must be one this workspace uploaded: a link
 * to anywhere else is refused, so the kit never points at media we do not hold.
 */
export async function saveBrandKit(
  deps: { db: Database; store: ObjectStore },
  workspaceId: string,
  raw: unknown,
): Promise<SaveBrandKitResult> {
  const parsed = brandKitSchema.safeParse(raw);
  const issues: InputIssue[] = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  const logoPrefix = deps.store.publicUrl(`${workspaceId}/brand/`);
  if (parsed.success && parsed.data.logoUrl && !parsed.data.logoUrl.startsWith(logoPrefix)) {
    issues.push({ path: 'logoUrl', message: 'Upload the logo again' });
  }
  if (!parsed.success || issues.length > 0) return { ok: false, reason: 'invalid_input', issues };

  const [latest] = await listBrandKitVersions(deps.db, workspaceId, 1);
  if (latest && changed(toInput(latest), parsed.data).length === 0) {
    return { ok: true, version: latest.version, changed: false };
  }
  const row = await createBrandKitVersion(deps.db, workspaceId, parsed.data);
  return { ok: true, version: row.version, changed: true };
}

export interface BrandKitVersionView {
  version: number;
  createdAt: string;
  changes: string[];
  kit: BrandKitInput;
}

export async function brandKitHistory(
  db: Database,
  workspaceId: string,
): Promise<BrandKitVersionView[]> {
  const rows = await listBrandKitVersions(db, workspaceId, 20);
  const kits = rows.map(toInput);
  return rows.map((row, i) => ({
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    changes: changed(kits[i + 1], kits[i] as BrandKitInput),
    kit: kits[i] as BrandKitInput,
  }));
}

export type LogoResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'invalid_input'; issues: InputIssue[] }
  | { ok: false; reason: 'blocked'; category: ModerationCategory }
  | { ok: false; reason: 'moderation_unavailable' };

/**
 * Stores a logo: PNG or JPEG only (an SVG can carry script), checked by moderation, then
 * resized to fit 512px as a PNG that keeps its transparency.
 */
export async function storeLogo(
  deps: { store: ObjectStore; moderation: ModerationAdapter; log: Logger },
  workspaceId: string,
  data: Uint8Array,
): Promise<LogoResult> {
  const invalid = (message: string): LogoResult => ({
    ok: false,
    reason: 'invalid_input',
    issues: [{ path: 'file', message }],
  });
  if (data.byteLength === 0) return invalid('The file is empty');
  if (data.byteLength > MAX_LOGO_BYTES) return invalid('Logos can be at most 2 MB');
  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (!jpeg && !png) return invalid('Logos must be PNG or JPEG');

  let logo: Uint8Array;
  try {
    const output = await sharp(data)
      .rotate()
      .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    logo = new Uint8Array(output);
  } catch (err) {
    deps.log.warn({ err }, 'logo could not be decoded');
    return invalid('The image could not be read; it may be damaged');
  }

  try {
    const verdict = await deps.moderation.checkImage({ data: logo, mimeType: 'image/png' });
    if (!verdict.allowed) {
      return { ok: false, reason: 'blocked', category: verdict.flagged[0]?.category ?? 'other' };
    }
  } catch (err) {
    deps.log.warn({ err }, 'logo moderation unavailable, upload refused');
    return { ok: false, reason: 'moderation_unavailable' };
  }

  const stored = await deps.store.put(
    `${workspaceId}/brand/logo-${randomUUID()}.png`,
    logo,
    'image/png',
  );
  return { ok: true, url: stored.url };
}
