import { describe, expect, it } from 'vitest';
import { JOB_STATUSES, settlementFor } from './jobs';

describe('settlementFor', () => {
  it('matches the credit positions in plan section 14', () => {
    const positions = Object.fromEntries(JOB_STATUSES.map((s) => [s, settlementFor(s)]));
    expect(positions).toEqual({
      QUEUED: null,
      RUNNING: null,
      MODERATING: null,
      COMPLETE: 'settle',
      BLOCKED: 'refund',
      FAILED: 'refund',
      CANCELLED: 'refund',
    });
  });
});
