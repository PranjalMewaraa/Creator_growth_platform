import type { MeteringRates } from '@cgp/contracts';
import {
  catalog,
  currentMeteringRates,
  templatePreviews,
  templates,
  templateVersions,
  type Database,
} from '@cgp/db';
import type { GeneratorRegistry } from './generators/registry';

// The template gallery (WP19, FR-TP). A template is a named set of directives the compiler
// treats as the template source: it can shape a brief, never lift a platform constraint or the
// safety policy. Every preview here is real output from that template version (invariant 14).

export interface TemplateCard {
  id: string;
  slug: string;
  title: string;
  description: string;
  outputType: string;
  version: number;
  costBand: string;
  /** What running this template costs, priced against the rates in force. */
  credits: number;
  /** Real output from this template version, or nothing until the pipeline has run. */
  preview: { mediaUrl: string | null; text: string | null; madeAt: string } | null;
}

/** The generator that makes a given output type, which is what prices a template. */
function generatorFor(registry: GeneratorRegistry, outputType: string) {
  return registry.list().find((generator) => generator.outputType === outputType);
}

function priceOf(registry: GeneratorRegistry, outputType: string, rates: MeteringRates): number {
  const generator = generatorFor(registry, outputType);
  if (!generator) return 0;
  // Priced on the smallest real request, which is what the gallery quotes.
  const prepared = generator.prepare({ intentText: 'preview', targetPlatform: null }, rates);
  return prepared.ok ? prepared.estimate.credits : 0;
}

/** Every template with its current version, price and preview. Catalog data, not per workspace. */
export async function listTemplates(
  db: Database,
  registry: GeneratorRegistry,
): Promise<TemplateCard[]> {
  const cat = catalog(db);
  // Read one at a time: Promise.all over different tables widens every row to a union.
  const rows = await cat.select(templates, { orderBy: (t, order) => order.asc(t.slug) });
  const versions = await cat.select(templateVersions);
  const previews = await cat.select(templatePreviews);
  const rates = await currentMeteringRates(db);

  // A template with no current version is a seed error, not a card: it is left out.
  return rows.flatMap((template) => {
    const version = versions.find(
      (row) => row.templateId === template.id && row.version === template.currentVersion,
    );
    if (!version) return [];
    const preview = previews.find((row) => row.templateVersionId === version.id);
    return [
      {
        id: template.id,
        slug: template.slug,
        title: template.title || template.slug,
        description: template.description,
        outputType: template.outputType,
        version: version.version,
        costBand: version.costBand,
        credits: priceOf(registry, template.outputType, rates),
        preview: preview
          ? {
              mediaUrl: preview.mediaUrl,
              text: preview.text,
              madeAt: preview.createdAt.toISOString(),
            }
          : null,
      },
    ];
  });
}
