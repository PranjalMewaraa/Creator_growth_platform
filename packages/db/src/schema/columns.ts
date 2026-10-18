import {
  CURRENCIES,
  JOB_CLASSES,
  JOB_STATUSES,
  LEDGER_REASONS,
  MEMBERSHIP_ROLES,
  OUTPUT_TYPES,
  POST_TARGET_STATUSES,
  TARGET_PLATFORMS,
  TREND_LIFECYCLE_STAGES,
  TREND_SOURCES,
} from '@cgp/contracts';
import { pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';

// Enum values come from @cgp/contracts, so the database and the app cannot drift apart.
export const jobClassEnum = pgEnum('job_class', JOB_CLASSES);
export const jobStatusEnum = pgEnum('job_status', JOB_STATUSES);
export const currencyEnum = pgEnum('currency', CURRENCIES);
export const ledgerReasonEnum = pgEnum('ledger_reason', LEDGER_REASONS);
export const outputTypeEnum = pgEnum('output_type', OUTPUT_TYPES);
export const platformEnum = pgEnum('platform', TARGET_PLATFORMS);
export const postTargetStatusEnum = pgEnum('post_target_status', POST_TARGET_STATUSES);
export const membershipRoleEnum = pgEnum('membership_role', MEMBERSHIP_ROLES);
export const trendLifecycleEnum = pgEnum('trend_lifecycle_stage', TREND_LIFECYCLE_STAGES);
export const trendSourceEnum = pgEnum('trend_source', TREND_SOURCES);

export const id = () => uuid('id').primaryKey().defaultRandom();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
