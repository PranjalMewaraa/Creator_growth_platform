/** Two currencies, never convertible (plan section 7). Both move only through the ledger. */
export const CURRENCIES = ['credits', 'video_seconds'] as const;

export type Currency = (typeof CURRENCIES)[number];

export type LedgerReason = 'hold' | 'settle' | 'refund' | 'grant';

export interface CreditEstimate {
  credits: number;
  videoSeconds?: number;
  breakdown: Array<{ label: string; credits: number }>;
}

/**
 * Versioned metering configuration, loaded from `metering_rates` (FR-BL-01).
 * Generators price against this, never against constants in code.
 */
export interface MeteringRates {
  version: number;
  /** Credits per metered action, keyed by action class, such as 'caption_set' or 'image_standard'. */
  credits: Readonly<Record<string, number>>;
}
