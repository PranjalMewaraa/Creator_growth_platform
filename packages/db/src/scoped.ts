import { and, eq } from 'drizzle-orm';
import type { PgColumn, PgInsertValue, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { unwrap, type Database, type Drizzle } from './client';
import { operators, selectRows, type Condition, type SelectOptions } from './query';
import { workspaces } from './schema';

/** Tables with a workspace_id column. Catalog tables do not qualify, so scoped() cannot reach them. */
export type WorkspaceTable = PgTable & { workspaceId: PgColumn };

/** workspace_id is always the scope's, so callers never pass it. */
export type ScopedInsert<T extends WorkspaceTable> = Omit<T['$inferInsert'], 'workspaceId'>;
export type ScopedUpdate<T extends WorkspaceTable> = Partial<
  Omit<T['$inferInsert'], 'workspaceId' | 'id'>
>;

export interface Scoped {
  readonly workspaceId: string;
  workspace(): Promise<typeof workspaces.$inferSelect | undefined>;
  select<T extends WorkspaceTable>(
    table: T,
    options?: SelectOptions<T>,
  ): Promise<T['$inferSelect'][]>;
  insert<T extends WorkspaceTable>(
    table: T,
    values: ScopedInsert<T> | ScopedInsert<T>[],
  ): Promise<T['$inferSelect'][]>;
  update<T extends WorkspaceTable>(
    table: T,
    set: ScopedUpdate<T>,
    where: Condition<T>,
  ): Promise<T['$inferSelect'][]>;
  delete<T extends WorkspaceTable>(table: T, where: Condition<T>): Promise<T['$inferSelect'][]>;
  transaction<R>(fn: (tx: Scoped) => Promise<R>): Promise<R>;
}

/** Every query this returns is limited to one workspace (invariant 1). */
export function scoped(db: Database, workspaceId: string): Scoped {
  return scopedOn(unwrap(db), workspaceId);
}

export function scopedOn(d: Drizzle, workspaceId: string): Scoped {
  const inWorkspace = <T extends WorkspaceTable>(table: T, where?: Condition<T>) =>
    and(eq(table.workspaceId, workspaceId), where?.(table, operators));

  // Update and delete must name their rows. A missing condition is a bug, not "everything".
  const required = <T extends WorkspaceTable>(table: T, where: Condition<T>, verb: string) => {
    const condition = where(table, operators);
    if (!condition) throw new Error(`Refusing to ${verb} every row in a workspace table`);
    return and(eq(table.workspaceId, workspaceId), condition);
  };

  const rejectForeignScope = (values: object) => {
    if ('workspaceId' in values && values.workspaceId !== workspaceId) {
      throw new Error('workspaceId is set by the scope and cannot be overridden');
    }
  };

  return {
    workspaceId,

    async workspace() {
      const [row] = await d.select().from(workspaces).where(eq(workspaces.id, workspaceId));
      return row;
    },

    select(table, options = {}) {
      return selectRows(d, table, inWorkspace(table, options.where), options);
    },

    async insert(table, values) {
      const rows = (Array.isArray(values) ? values : [values]).map((row) => {
        rejectForeignScope(row);
        return { ...row, workspaceId };
      });
      if (rows.length === 0) return [];
      const inserted = await d
        .insert(table as PgTable)
        .values(rows as PgInsertValue<PgTable>[])
        .returning();
      return inserted;
    },

    async update(table, set, where) {
      rejectForeignScope(set);
      const updated = await d
        .update(table as PgTable)
        .set(set as PgUpdateSetSource<PgTable>)
        .where(required(table, where, 'update'))
        .returning();
      return updated;
    },

    async delete(table, where) {
      const deleted = await d
        .delete(table as PgTable)
        .where(required(table, where, 'delete'))
        .returning();
      return deleted;
    },

    transaction(fn) {
      return d.transaction((tx) => fn(scopedOn(tx, workspaceId)));
    },
  };
}
