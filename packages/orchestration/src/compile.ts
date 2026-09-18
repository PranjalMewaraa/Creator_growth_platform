import type { Logger } from '@cgp/config';
import type {
  CompiledPromptView,
  CompilerProfileConfig,
  OutputType,
  TargetPlatform,
  TextAdapter,
} from '@cgp/contracts';
import {
  brandKits,
  catalog,
  compiledPrompts,
  compilerProfiles,
  scoped,
  templates,
  templateVersions,
  workspaceProfiles,
  type Database,
} from '@cgp/db';
import { collectDirectives } from './directives';
import { routeLanguage } from './language';
import { assembleBrief, briefOf, enforce } from './render';
import { deriveSettings, resolveSettings } from './resolve';
import { rewriteBrief } from './rewrite';

export interface CompileDeps {
  db: Database;
  /** The rewrite providers in order: Flash-Lite, then gpt-oss as the second (plan section 6). */
  rewriters: TextAdapter[];
  log?: Logger;
  /** Only tests change this. */
  rewriteBudgetMs?: number;
}

export interface CompileRequest {
  workspaceId: string;
  outputType: OutputType;
  intentText: string;
  /** The output type's default template when absent. */
  templateId?: string;
  targetPlatform: TargetPlatform | null;
  /** Explicit user instructions, such as tone or durationSeconds. */
  params: Record<string, unknown>;
}

export type CompileOutcome =
  | { ok: true; prompt: CompiledPromptView }
  | {
      ok: false;
      reason: 'profile_required' | 'brand_kit_required' | 'template_not_found';
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function latest<T extends typeof workspaceProfiles | typeof brandKits>(
  db: Database,
  workspaceId: string,
  table: T,
) {
  const [row] = await scoped(db, workspaceId).select(table, {
    orderBy: (t, order) => order.desc(t.version),
    limit: 1,
  });
  return row;
}

async function findTemplate(db: Database, outputType: OutputType, templateId?: string) {
  const cat = catalog(db);
  if (templateId !== undefined && !UUID.test(templateId)) return undefined;
  const [template] = await cat.select(templates, {
    where: (t, op) =>
      templateId === undefined ? op.eq(t.slug, `default-${outputType}`) : op.eq(t.id, templateId),
    limit: 1,
  });
  if (!template || template.outputType !== outputType) return undefined;
  const [version] = await cat.select(templateVersions, {
    where: (t, op) =>
      op.and(op.eq(t.templateId, template.id), op.eq(t.version, template.currentVersion)),
    limit: 1,
  });
  return version ? { template, version } : undefined;
}

/** The newest version of a compiler profile. Seeded, so a missing one is a deploy error. */
async function compilerProfile(db: Database, key: string) {
  const [row] = await catalog(db).select(compilerProfiles, {
    where: (t, op) => op.eq(t.key, key),
    orderBy: (t, order) => order.desc(t.version),
    limit: 1,
  });
  if (!row) throw new Error(`Compiler profile ${key} is not seeded`);
  return row;
}

export function toView(row: typeof compiledPrompts.$inferSelect): CompiledPromptView {
  return {
    id: row.id,
    text: row.text,
    outputType: row.outputType,
    parentId: row.parentId,
    language: routeLanguage(row.language).language,
    settings: row.settings,
    fallbackUsed: row.fallbackUsed,
    userEdited: row.userEdited,
    lineage: {
      intentText: row.intentText,
      templateVersion: row.templateVersion,
      profileVersion: row.profileVersion,
      brandKitVersion: row.brandKitVersion,
      compilerProfileVersion: row.compilerProfileVersion,
    },
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Plain intent to a persisted compiled prompt (plan section 5): stage 1 assembly, stage 2
 * rewrite, stage 3 enforcement, then the artifact with full lineage (invariant 8). Spends no
 * credit, and the rewrite pass can only ever make it better, never make it fail.
 */
export async function compile(deps: CompileDeps, request: CompileRequest): Promise<CompileOutcome> {
  const { db } = deps;
  const { workspaceId } = request;
  const profile = await latest(db, workspaceId, workspaceProfiles);
  if (!profile) return { ok: false, reason: 'profile_required' };
  const brandKit = await latest(db, workspaceId, brandKits);
  if (!brandKit) return { ok: false, reason: 'brand_kit_required' };
  const found = await findTemplate(db, request.outputType, request.templateId);
  if (!found) return { ok: false, reason: 'template_not_found' };

  const language = routeLanguage(profile.language);
  const profileRow = await compilerProfile(
    db,
    language.compilerProfileKey(found.version.compilerProfileRef),
  );
  const config = profileRow.config as CompilerProfileConfig;

  // Stage 1: every source's directives, resolved by precedence, then the brief.
  const settings = deriveSettings(
    resolveSettings(
      collectDirectives({
        outputType: request.outputType,
        targetPlatform: request.targetPlatform,
        params: request.params,
        template: found.version,
        config,
        profile,
        brandKit,
        language,
      }),
    ),
  );
  const stage1 = assembleBrief(config, request.intentText, settings);

  // Stage 2: the rewrite pass, inside its budget.
  const rewrite = await rewriteBrief({
    brief: stage1,
    system: config.rewrite.system,
    maxOutputTokens: config.rewrite.maxOutputTokens,
    providers: deps.rewriters,
    budgetMs: deps.rewriteBudgetMs,
    log: deps.log,
  });
  if (!rewrite.fallbackUsed) {
    deps.log?.info(
      { provider: rewrite.provider, usage: rewrite.usage, elapsedMs: rewrite.elapsedMs },
      'rewrite pass done',
    );
  }

  // Stage 3: requirements rebuilt from the settings, whatever the brief says.
  const text = enforce(rewrite.brief, config, settings);

  const [row] = await scoped(db, workspaceId).insert(compiledPrompts, {
    text,
    intentText: request.intentText,
    templateId: found.template.id,
    templateVersion: found.version.version,
    profileVersion: profile.version,
    brandKitVersion: brandKit.version,
    compilerProfileKey: profileRow.key,
    compilerProfileVersion: profileRow.version,
    outputType: request.outputType,
    language: language.language,
    settings,
    fallbackUsed: rewrite.fallbackUsed,
  });
  if (!row) throw new Error('Compiled prompt insert returned no row');
  return { ok: true, prompt: toView(row) };
}

export async function findCompiledPrompt(
  db: Database,
  workspaceId: string,
  id: string,
): Promise<typeof compiledPrompts.$inferSelect | undefined> {
  if (!UUID.test(id)) return undefined;
  const [row] = await scoped(db, workspaceId).select(compiledPrompts, {
    where: (t, op) => op.eq(t.id, id),
    limit: 1,
  });
  return row;
}

export type EditOutcome =
  | { ok: true; prompt: CompiledPromptView; changed: boolean }
  | { ok: false; reason: 'not_found' | 'empty' };

/**
 * A user edit is a new version whose parent is the prompt it came from; the parent never
 * changes. The edit is an explicit user instruction, so it replaces the brief, while the
 * requirements are re-applied from the parent's settings: an edit cannot remove the safety
 * policy or a platform constraint, which outrank it.
 */
export async function editCompiledPrompt(
  db: Database,
  workspaceId: string,
  parentId: string,
  editedText: string,
): Promise<EditOutcome> {
  const parent = await findCompiledPrompt(db, workspaceId, parentId);
  if (!parent) return { ok: false, reason: 'not_found' };
  if (briefOf(editedText).length === 0) return { ok: false, reason: 'empty' };

  const [profileRow] = await catalog(db).select(compilerProfiles, {
    where: (t, op) =>
      op.and(
        op.eq(t.key, parent.compilerProfileKey),
        op.eq(t.version, parent.compilerProfileVersion),
      ),
    limit: 1,
  });
  if (!profileRow) throw new Error(`Compiler profile ${parent.compilerProfileKey} is missing`);

  const text = enforce(editedText, profileRow.config as CompilerProfileConfig, parent.settings);
  if (text === parent.text) return { ok: true, prompt: toView(parent), changed: false };

  const [row] = await scoped(db, workspaceId).insert(compiledPrompts, {
    parentId: parent.id,
    text,
    intentText: parent.intentText,
    templateId: parent.templateId,
    templateVersion: parent.templateVersion,
    profileVersion: parent.profileVersion,
    brandKitVersion: parent.brandKitVersion,
    compilerProfileKey: parent.compilerProfileKey,
    compilerProfileVersion: parent.compilerProfileVersion,
    outputType: parent.outputType,
    language: parent.language,
    settings: parent.settings,
    userEdited: true,
    fallbackUsed: false,
  });
  if (!row) throw new Error('Compiled prompt insert returned no row');
  return { ok: true, prompt: toView(row), changed: true };
}
