/** Owner and Editor only for the demo. The approval queue is hidden (FR-ON-08). */
export const MEMBERSHIP_ROLES = ['owner', 'editor'] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
