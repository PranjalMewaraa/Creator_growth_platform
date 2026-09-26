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
export { authDatabaseAdapter } from './auth';
export { findMembership, listWorkspacesForUser, type WorkspaceMembership } from './memberships';
export { grant } from './ledger';
export {
  createJobWithHold,
  jobsToRecover,
  ledgerDrift,
  markJobModerating,
  markJobRunning,
  refundJob,
  rescheduleJob,
  settleJob,
  type Amounts,
  type BalanceDrift,
  type CostTelemetry,
  type CreateJobResult,
  type EndJobResult,
  type JobRow,
  type NewJob,
} from './jobs';
export { currentMeteringRates } from './rates';
export {
  addMusicTrack,
  findMusicTrack,
  listMusicTracks,
  type MusicTrackRow,
  type TrackLicence,
} from './music';
export { deleteTemplatePreview, saveTemplatePreview } from './template-previews';
export {
  createScenes,
  findScene,
  listScenes,
  replaceSceneClip,
  setSceneClip,
  type VideoSceneRow,
} from './video-scenes';
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
  outputEdits,
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
export { COMPILER_PROFILE_VERSION, COMPILER_PROFILES } from './seed-catalog';
export {
  claimPostTarget,
  createPublication,
  findPostTarget,
  findPublication,
  publicationsBetween,
  recentPostTargets,
  markPostTarget,
  markPublished,
  markPublishStarted,
  PUBLISH_TARGET,
  setPreparedRef,
  upsertSocialAccount,
  type CreatePublicationResult,
  type PublicationWithTargets,
  type RecentPostTarget,
  type NewPublication,
  type NewSocialAccount,
  type PostTargetRow,
  type PublicationRow,
  type SocialAccountRow,
} from './publishing';
export { findRendition, renditionsFor, saveRendition, type RenditionRow } from './renditions';
export {
  createProfileVersion,
  listProfileVersions,
  type ProfileFields,
  type ProfileRow,
} from './profiles';
export {
  createBrandKitVersion,
  listBrandKitVersions,
  type BrandKitFields,
  type BrandKitRow,
} from './brand-kits';
