import { outputEdits, outputs, scoped, type Database } from '@cgp/db';
import { editDistance, editRate } from './edit-distance';

// Accepting an output (WP20): the creator says "this one, as I have it now", and the distance
// between what the engine wrote and what they kept is recorded. Nothing else changes: the
// output row is the artifact and stays exactly as generated.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The longest accepted text worth measuring against; anything more is a different piece. */
const MAX_ACCEPTED_CHARS = 20_000;

export interface AcceptedEdit {
  distance: number;
  rate: number;
}

export type AcceptOutputResult =
  { ok: true; edit: AcceptedEdit } | { ok: false; reason: 'output_not_found' | 'invalid_input' };

/**
 * Records what was kept. The generated side is whichever text the output holds: for a caption
 * set that is the JSON the model returned, so the caller passes the caption it accepted and
 * the field it came from is measured against it.
 */
export async function acceptOutput(
  db: Database,
  workspaceId: string,
  outputId: string,
  accepted: string,
  /** The generated text this is a version of, when the output holds several. */
  generatedOverride?: string,
): Promise<AcceptOutputResult> {
  if (!UUID.test(outputId)) return { ok: false, reason: 'output_not_found' };
  if (accepted.length > MAX_ACCEPTED_CHARS) return { ok: false, reason: 'invalid_input' };

  const ws = scoped(db, workspaceId);
  const [output] = await ws.select(outputs, { where: (t, op) => op.eq(t.id, outputId), limit: 1 });
  if (!output) return { ok: false, reason: 'output_not_found' };

  const stored = (output.metadata as { text?: unknown }).text;
  const generated = generatedOverride ?? (typeof stored === 'string' ? stored : '');
  if (!generated) return { ok: false, reason: 'invalid_input' };

  const edit = { distance: editDistance(generated, accepted), rate: editRate(generated, accepted) };
  await ws.insert(outputEdits, {
    outputId,
    distance: edit.distance,
    rate: edit.rate,
    generatedChars: generated.length,
    acceptedChars: accepted.length,
  });
  return { ok: true, edit };
}

export interface EditRateSummary {
  accepted: number;
  /** Mean share of the output that was changed. Lower is an engine doing more of the work. */
  meanRate: number;
  /** Accepted with nothing changed at all. */
  untouched: number;
}

/** What the edits say so far. Thin until the demo has been used, which is honest. */
export async function editRateSummary(db: Database, workspaceId: string): Promise<EditRateSummary> {
  const rows = await scoped(db, workspaceId).select(outputEdits);
  if (rows.length === 0) return { accepted: 0, meanRate: 0, untouched: 0 };
  const total = rows.reduce((sum, row) => sum + row.rate, 0);
  return {
    accepted: rows.length,
    meanRate: Number((total / rows.length).toFixed(4)),
    untouched: rows.filter((row) => row.distance === 0).length,
  };
}
