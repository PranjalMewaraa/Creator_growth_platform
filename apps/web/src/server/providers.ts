import 'server-only';
import { createProviders, warmProviders, type Providers } from '@cgp/adapters';
import { getEnv, getLogger } from './runtime';

// Kept apart from runtime.ts on purpose: importing this pulls in every provider SDK, and most
// pages only need the database. Splitting it took about eight seconds off a cold route compile
// in development for the pages that do not generate anything.

const providers = globalThis as typeof globalThis & { cgpProviders?: Providers };

/**
 * Provider adapters chosen by PROVIDERS: fakes unless real calls were asked for. The compile
 * rewrite pass runs here, in the request, so this process warms the providers as soon as it
 * builds them: otherwise the first compile of every server instance breaches the 1500ms budget
 * on connection setup alone and silently falls back (D17).
 */
export function getProviders(): Providers {
  if (providers.cgpProviders) return providers.cgpProviders;
  const created = createProviders({ ...getEnv(), log: getLogger() });
  providers.cgpProviders = created;
  void warmProviders(created, getLogger());
  return created;
}
