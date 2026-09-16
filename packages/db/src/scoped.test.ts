import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog } from './catalog';
import type { Database } from './client';
import type { Condition } from './query';
import { jobs, users } from './schema';
import { scoped } from './scoped';
import { makeWorkspace } from './test-fixtures';
import { createTestDatabase } from './testing';

let db: Database;
let a: string;
let b: string;

const job = (generatorKey: string) => ({ jobClass: 'inference' as const, generatorKey });

beforeAll(async () => {
  db = await createTestDatabase();
  a = (await makeWorkspace(db, 'A')).id;
  b = (await makeWorkspace(db, 'B')).id;
});

afterAll(() => db.close());

describe('scoped', () => {
  it('reads only its own workspace', async () => {
    await scoped(db, a).insert(jobs, job('read-a'));
    await scoped(db, b).insert(jobs, [job('read-b1'), job('read-b2')]);

    const fromA = await scoped(db, a).select(jobs, {
      where: (t, op) => op.inArray(t.generatorKey, ['read-a', 'read-b1', 'read-b2']),
    });
    expect(fromA.map((row) => row.generatorKey)).toEqual(['read-a']);
    expect(fromA.every((row) => row.workspaceId === a)).toBe(true);
  });

  it('cannot update or delete another workspace row, even by id', async () => {
    const [target] = await scoped(db, b).insert(jobs, job('cross-write'));
    if (!target) throw new Error('insert returned no row');
    const byId: Condition<typeof jobs> = (t, op) => op.eq(t.id, target.id);

    expect(await scoped(db, a).update(jobs, { status: 'CANCELLED' }, byId)).toEqual([]);
    expect(await scoped(db, a).delete(jobs, byId)).toEqual([]);
    const [still] = await scoped(db, b).select(jobs, { where: byId });
    expect(still?.status).toBe('QUEUED');
  });

  it('stamps its own workspace and refuses to write another', async () => {
    const [row] = await scoped(db, a).insert(jobs, job('stamped'));
    expect(row?.workspaceId).toBe(a);

    await expect(
      scoped(db, a).insert(jobs, { ...job('smuggled'), workspaceId: b } as never),
    ).rejects.toThrow(/cannot be overridden/);
    await expect(
      scoped(db, a).update(jobs, { workspaceId: b } as never, (t, op) =>
        op.eq(t.generatorKey, 'stamped'),
      ),
    ).rejects.toThrow(/cannot be overridden/);
  });

  it('refuses an update or delete with no condition', async () => {
    await expect(scoped(db, a).update(jobs, { status: 'FAILED' }, () => undefined)).rejects.toThrow(
      /every row/,
    );
    await expect(scoped(db, a).delete(jobs, () => undefined)).rejects.toThrow(/every row/);
  });

  it('applies order and limit within the scope', async () => {
    await scoped(db, a).insert(jobs, [job('order-2'), job('order-1'), job('order-3')]);
    const rows = await scoped(db, a).select(jobs, {
      where: (t, op) => op.inArray(t.generatorKey, ['order-1', 'order-2', 'order-3']),
      orderBy: (t, order) => order.asc(t.generatorKey),
      limit: 2,
    });
    expect(rows.map((row) => row.generatorKey)).toEqual(['order-1', 'order-2']);
  });

  it('rolls back everything in a failed transaction', async () => {
    await expect(
      scoped(db, a).transaction(async (tx) => {
        await tx.insert(jobs, job('rolled-back'));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const rows = await scoped(db, a).select(jobs, {
      where: (t, op) => op.eq(t.generatorKey, 'rolled-back'),
    });
    expect(rows).toEqual([]);
  });

  it('returns its own workspace row', async () => {
    expect((await scoped(db, a).workspace())?.name).toBe('A');
  });

  it('keeps catalog tables and the raw query builder out of reach', () => {
    // Never called: these lines only need to fail to compile, which tsc checks.
    const typeOnly = () => {
      // @ts-expect-error users has no workspace_id, so it is not a scoped table
      void scoped(db, a).select(users);
      // @ts-expect-error jobs is tenant data, so catalog() cannot read it
      void catalog(db).select(jobs);
      // @ts-expect-error the Database handle exposes no query builder
      void db.select;
    };
    expect(typeOnly).toBeTypeOf('function');
  });
});
