import { randomUUID } from 'node:crypto';
import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createdAt, updatedAt } from './columns';

// Identity tables (A11): neither tenant data nor catalog. Written only by the auth layer in
// this package. Property names match what better-auth expects; columns stay snake_case.
//
// Ids are text, not uuid: the auth library supplies its own ids, and for a magic link the
// token itself becomes the verification row's id. Seeded rows get a uuid all the same.
const authId = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const users = pgTable('users', {
  id: authId(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: authId(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user').on(t.userId)],
);

/** Required by the auth library. Unused while sign in is a magic link only. */
export const accounts = pgTable('accounts', {
  id: authId(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Single use magic link tokens. */
export const verifications = pgTable(
  'verifications',
  {
    id: authId(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier').on(t.identifier)],
);
