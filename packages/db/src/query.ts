import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  type SQL,
} from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Drizzle } from './client';

// Handed to condition callbacks, so callers outside this package never import drizzle.
export const operators = {
  and,
  or,
  not,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  isNull,
  isNotNull,
};
export const ordering = { asc, desc };

export type Operators = typeof operators;
export type Ordering = typeof ordering;

export type Condition<T> = (table: T, op: Operators) => SQL | undefined;

export interface SelectOptions<T> {
  where?: Condition<T>;
  orderBy?: (table: T, order: Ordering) => SQL | PgColumn | Array<SQL | PgColumn>;
  limit?: number;
}

export async function selectRows<T extends PgTable>(
  d: Drizzle,
  table: T,
  where: SQL | undefined,
  { orderBy, limit }: SelectOptions<T>,
): Promise<T['$inferSelect'][]> {
  // Drizzle's from() cannot resolve a generic table, so widen it first.
  const source: PgTable = table;
  const query = d.select().from(source).where(where).$dynamic();
  if (orderBy) {
    const order = orderBy(table, ordering);
    query.orderBy(...(Array.isArray(order) ? order : [order]));
  }
  if (limit !== undefined) query.limit(limit);
  return await query;
}
