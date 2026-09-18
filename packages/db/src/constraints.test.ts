import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrap, type Database, type Drizzle } from './client';
import { applyLedgerEntry, grant } from './ledger';
import {
  brandKits,
  compiledPrompts,
  compilerProfiles,
  creditLedger,
  jobs,
  postTargets,
  publications,
  socialAccounts,
  templatePreviews,
  templates,
  templateVersions,
  workspaceProfiles,
  workspaces,
} from './schema';
import { scoped } from './scoped';
import { makeWorkspace, sqlState, SQLSTATE } from './test-fixtures';
import { createTestDatabase } from './testing';

let db: Database;
let d: Drizzle;
let ws: string;

async function newJob() {
  const [row] = await scoped(db, ws).insert(jobs, { jobClass: 'inference', generatorKey: 'test' });
  if (!row) throw new Error('insert returned no row');
  return row.id;
}

async function balances(workspaceId: string) {
  const [row] = await d.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const entries = await d
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.workspaceId, workspaceId));
  const sum = (currency: string) =>
    entries.filter((e) => e.currency === currency).reduce((total, e) => total + e.delta, 0);
  return {
    cached: { credits: row?.creditBalance, videoSeconds: row?.videoSecondsBalance },
    ledger: { credits: sum('credits'), videoSeconds: sum('video_seconds') },
  };
}

beforeAll(async () => {
  db = await createTestDatabase();
  d = unwrap(db);
  ws = (await makeWorkspace(db, 'Constraints')).id;
  await grant(db, ws, 'credits', 100);
});

afterAll(() => db.close());

describe('migrations', () => {
  it('create every table the plan calls for, and nothing else', async () => {
    const result = (await d.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    )) as { rows: Array<{ table_name: string }> };

    expect(result.rows.map((row) => row.table_name)).toEqual([
      // Identity (A11)
      'accounts',
      'brand_kits',
      'compiled_prompts',
      'compiler_profiles',
      'cost_telemetry',
      'credit_ledger',
      'jobs',
      'memberships',
      'metering_rates',
      'moderation_events',
      'music_tracks',
      'outputs',
      'post_targets',
      'publications',
      'renditions',
      'sessions',
      'slots',
      'social_accounts',
      'template_previews',
      'template_versions',
      'templates',
      'users',
      'verifications',
      'video_scenes',
      'workspace_profiles',
      'workspaces',
    ]);
  });
});

describe('credit ledger', () => {
  it('keeps each cached balance equal to its ledger sum', async () => {
    const other = (await makeWorkspace(db, 'Balances')).id;
    await grant(db, other, 'credits', 50);
    await grant(db, other, 'credits', 25);
    await grant(db, other, 'video_seconds', 24);

    const { cached, ledger } = await balances(other);
    expect(cached).toEqual({ credits: 75, videoSeconds: 24 });
    expect(ledger).toEqual(cached);
  });

  it('rejects a grant that is not a positive whole number', async () => {
    await expect(grant(db, ws, 'credits', 0)).rejects.toThrow(/positive whole number/);
    await expect(grant(db, ws, 'credits', 1.5)).rejects.toThrow(/positive whole number/);
  });

  it('rejects a second settle for the same job and currency (A3)', async () => {
    const jobId = await newJob();
    const entry = { workspaceId: ws, jobId, currency: 'credits' as const };
    await d.transaction((tx) => applyLedgerEntry(tx, { ...entry, delta: -6, reason: 'hold' }));
    await d.transaction((tx) => applyLedgerEntry(tx, { ...entry, delta: 1, reason: 'settle' }));

    const again = d.transaction((tx) =>
      applyLedgerEntry(tx, { ...entry, delta: 1, reason: 'settle' }),
    );
    expect(await sqlState(again)).toBe(SQLSTATE.uniqueViolation);
  });

  it('is append only: UPDATE and DELETE are refused (invariant 6)', async () => {
    const [entry] = await d.select().from(creditLedger).where(eq(creditLedger.workspaceId, ws));
    if (!entry) throw new Error('expected a ledger entry');
    expect(
      await sqlState(
        d.update(creditLedger).set({ delta: 999 }).where(eq(creditLedger.id, entry.id)),
      ),
    ).toBe(SQLSTATE.restrictViolation);
    expect(await sqlState(d.delete(creditLedger).where(eq(creditLedger.id, entry.id)))).toBe(
      SQLSTATE.restrictViolation,
    );
  });

  it('enforces entry signs: holds debit, settles never charge above the hold', async () => {
    const jobId = await newJob();
    const base = { workspaceId: ws, jobId, currency: 'credits' as const };
    expect(
      await sqlState(d.insert(creditLedger).values({ ...base, delta: 5, reason: 'hold' })),
    ).toBe(SQLSTATE.checkViolation);
    expect(
      await sqlState(d.insert(creditLedger).values({ ...base, delta: -1, reason: 'settle' })),
    ).toBe(SQLSTATE.checkViolation);
  });

  it('never lets a balance go negative', async () => {
    const jobId = await newJob();
    const overdraw = d.transaction((tx) =>
      applyLedgerEntry(tx, {
        workspaceId: ws,
        jobId,
        currency: 'credits',
        delta: -10_000,
        reason: 'hold',
      }),
    );
    expect(await sqlState(overdraw)).toBe(SQLSTATE.checkViolation);
    const { cached, ledger } = await balances(ws);
    expect(cached.credits).toBe(ledger.credits);
  });
});

describe('integrity', () => {
  it('only accepts template previews that are real output (invariant 14)', async () => {
    const [template] = await d
      .insert(templates)
      .values({ slug: 'preview-check', outputType: 'image' })
      .returning();
    const [version] = await d
      .insert(templateVersions)
      .values({
        templateId: template!.id,
        version: 1,
        aspectRatio: '4:5',
        modelTier: 'fast',
        compilerProfileRef: 'image',
        costBand: 'low',
      })
      .returning();
    const preview = { templateVersionId: version!.id, mediaUrl: 'previews/x.png' };

    expect(
      await sqlState(d.insert(templatePreviews).values({ ...preview, isRealOutput: false })),
    ).toBe(SQLSTATE.checkViolation);
    expect(
      await sqlState(d.insert(templatePreviews).values({ ...preview, isRealOutput: true })),
    ).toBeUndefined();
  });

  it('refuses a published target without a platform post id (invariant 9)', async () => {
    const s = scoped(db, ws);
    const [publication] = await s.insert(publications, {
      scheduledAt: new Date(),
      timezone: 'Asia/Kolkata',
    });
    const [account] = await s.insert(socialAccounts, {
      platform: 'instagram',
      externalId: 'ig-1',
      tokenCiphertext: 'x',
    });
    const target = { publicationId: publication!.id, socialAccountId: account!.id };

    expect(await sqlState(s.insert(postTargets, { ...target, status: 'published' }))).toBe(
      SQLSTATE.checkViolation,
    );
    expect(
      await sqlState(
        s.insert(postTargets, { ...target, status: 'published', platformPostId: '1789' }),
      ),
    ).toBeUndefined();
  });

  it('refuses compiled prompt lineage that points at a version that does not exist (invariant 8)', async () => {
    const s = scoped(db, ws);
    await s.insert(workspaceProfiles, { version: 1 });
    await s.insert(brandKits, { version: 1 });
    const [template] = await d
      .insert(templates)
      .values({ slug: 'lineage-check', outputType: 'caption' })
      .returning();
    await d.insert(templateVersions).values({
      templateId: template!.id,
      version: 1,
      aspectRatio: '1:1',
      modelTier: 'fast',
      compilerProfileRef: 'caption',
      costBand: 'low',
    });
    await d
      .insert(compilerProfiles)
      .values({ key: 'caption.lineage', outputType: 'caption', version: 1, config: {} });
    const prompt = {
      text: 'compiled',
      intentText: 'intent',
      templateId: template!.id,
      templateVersion: 1,
      profileVersion: 1,
      brandKitVersion: 1,
      compilerProfileKey: 'caption.lineage',
      compilerProfileVersion: 1,
      outputType: 'caption' as const,
    };

    expect(await sqlState(s.insert(compiledPrompts, prompt))).toBeUndefined();
    expect(await sqlState(s.insert(compiledPrompts, { ...prompt, profileVersion: 2 }))).toBe(
      SQLSTATE.foreignKeyViolation,
    );
    expect(await sqlState(s.insert(compiledPrompts, { ...prompt, templateVersion: 9 }))).toBe(
      SQLSTATE.foreignKeyViolation,
    );
    expect(
      await sqlState(s.insert(compiledPrompts, { ...prompt, compilerProfileVersion: 2 })),
    ).toBe(SQLSTATE.foreignKeyViolation);
  });
});
