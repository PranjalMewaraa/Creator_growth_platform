import { unwrap, type Database } from './client';
import { templatePreviews } from './schema';

/**
 * The one way to write a gallery preview. The catalog is otherwise read only, but a preview is
 * generated rather than authored (invariant 14), so the pipeline needs a door of its own. One
 * per template version: generating it again replaces what was there.
 */
export async function saveTemplatePreview(
  db: Database,
  fields: { templateVersionId: string; mediaUrl: string | null; text: string | null },
): Promise<void> {
  if (fields.mediaUrl === null && fields.text === null) {
    throw new Error('A preview needs a picture or words');
  }
  await unwrap(db)
    .insert(templatePreviews)
    .values({ ...fields, isRealOutput: true })
    .onConflictDoUpdate({
      target: templatePreviews.templateVersionId,
      set: { mediaUrl: fields.mediaUrl, text: fields.text },
    });
}
