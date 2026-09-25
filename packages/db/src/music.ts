import { asc, eq } from 'drizzle-orm';
import { unwrap, type Database } from './client';
import { musicTracks } from './schema';

export type MusicTrackRow = typeof musicTracks.$inferSelect;

/**
 * FR-VD-08: every track carries its licence. A bed with no licence recorded is a legal
 * problem wearing a demo's clothes, so there is no way to add one without saying where it came
 * from and what the terms are.
 */
export interface TrackLicence {
  /** Where it was obtained: a library name or a URL. */
  source: string;
  /** The licence itself, named as the source names it, such as `CC0-1.0`. */
  licence: string;
  /** What the licence requires, in the words a person would put in a caption. Empty if none. */
  attribution: string;
}

export async function addMusicTrack(
  db: Database,
  track: { title: string; storageKey: string; licence: TrackLicence },
): Promise<MusicTrackRow> {
  const { source, licence, attribution } = track.licence;
  if (!source.trim() || !licence.trim()) {
    throw new Error('A track needs a source and a licence');
  }
  const [row] = await unwrap(db)
    .insert(musicTracks)
    .values({
      title: track.title,
      storageKey: track.storageKey,
      licence: { source, licence, attribution },
    })
    .returning();
  if (!row) throw new Error('Music track insert returned no row');
  return row;
}

/** The catalogue, by title. Empty until tracks are added, and a reel renders without a bed. */
export async function listMusicTracks(db: Database): Promise<MusicTrackRow[]> {
  return unwrap(db).select().from(musicTracks).orderBy(asc(musicTracks.title));
}

export async function findMusicTrack(db: Database, id: string): Promise<MusicTrackRow | undefined> {
  const [row] = await unwrap(db).select().from(musicTracks).where(eq(musicTracks.id, id));
  return row;
}
