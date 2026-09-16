// The public surface of @cgp/db. The raw query builder is deliberately absent: callers get an
// opaque Database and reach rows only through scoped() or catalog() (invariant 1).
export { createDatabase, type Database } from './client';
export {
  scoped,
  type Scoped,
  type ScopedInsert,
  type ScopedUpdate,
  type WorkspaceTable,
} from './scoped';
export { catalog, CATALOG_TABLES, type Catalog, type CatalogTable } from './catalog';
export type { Condition, Operators, Ordering, SelectOptions } from './query';
export { createWorkspace, type NewWorkspace } from './workspaces';
export { grant } from './ledger';
export {
  brandKits,
  compiledPrompts,
  compilerProfiles,
  costTelemetry,
  creditLedger,
  jobs,
  memberships,
  meteringRates,
  moderationEvents,
  musicTracks,
  outputs,
  postTargets,
  publications,
  renditions,
  slots,
  socialAccounts,
  templatePreviews,
  templates,
  templateVersions,
  users,
  videoScenes,
  workspaceProfiles,
  workspaces,
} from './schema';
