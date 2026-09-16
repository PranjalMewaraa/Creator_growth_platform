import { unwrap, type Database } from './client';
import { operators, selectRows, type SelectOptions } from './query';
import {
  compilerProfiles,
  meteringRates,
  musicTracks,
  templatePreviews,
  templates,
  templateVersions,
} from './schema';

/** Global catalog tables (plan section 8, A1): shared reference data, written only by seed. */
export const CATALOG_TABLES = {
  templates,
  templateVersions,
  templatePreviews,
  compilerProfiles,
  meteringRates,
  musicTracks,
};

export type CatalogTable = (typeof CATALOG_TABLES)[keyof typeof CATALOG_TABLES];

export interface Catalog {
  select<T extends CatalogTable>(
    table: T,
    options?: SelectOptions<T>,
  ): Promise<T['$inferSelect'][]>;
}

/** Read only access to the catalog. There is deliberately no write method. */
export function catalog(db: Database): Catalog {
  const d = unwrap(db);
  return {
    select(table, options = {}) {
      return selectRows(d, table, options.where?.(table, operators), options);
    },
  };
}
