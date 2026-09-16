import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unwrap, type Database } from './client';
import { findMembership, listWorkspacesForUser } from './memberships';
import { memberships, users } from './schema';
import { createTestDatabase } from './testing';
import { createWorkspace } from './workspaces';

let db: Database;
let owner: string;
let stranger: string;
let mine: string;
let theirs: string;

beforeAll(async () => {
  db = await createTestDatabase();
  const [a, b] = await unwrap(db)
    .insert(users)
    .values([
      { name: 'Owner', email: 'owner@example.com' },
      { name: 'Stranger', email: 'stranger@example.com' },
    ])
    .returning();
  owner = a!.id;
  stranger = b!.id;
  mine = (await createWorkspace(db, { name: 'Mine', ownerUserId: owner })).id;
  theirs = (await createWorkspace(db, { name: 'Theirs', ownerUserId: stranger })).id;
});

afterAll(() => db.close());

describe('membership lookups', () => {
  it('lists only the workspaces a user belongs to', async () => {
    expect((await listWorkspacesForUser(db, owner)).map((w) => w.name)).toEqual(['Mine']);
    expect((await listWorkspacesForUser(db, stranger)).map((w) => w.name)).toEqual(['Theirs']);
  });

  it('refuses a workspace the user is not a member of', async () => {
    expect(await findMembership(db, owner, mine)).toMatchObject({
      workspaceId: mine,
      role: 'owner',
    });
    expect(await findMembership(db, owner, theirs)).toBeUndefined();
  });

  it('follows the membership once one is added', async () => {
    await unwrap(db)
      .insert(memberships)
      .values({ workspaceId: theirs, userId: owner, role: 'editor' });
    expect(await findMembership(db, owner, theirs)).toMatchObject({ role: 'editor' });
    expect((await listWorkspacesForUser(db, owner)).map((w) => w.name)).toEqual(['Mine', 'Theirs']);
  });
});
