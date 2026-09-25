import type { Logger } from '@cgp/config';
import type { TextAdapter } from '@cgp/contracts';
import type { Providers } from './registry';

/**
 * The first Vertex call of a process pays for application default credentials, a token
 * exchange, DNS and a TLS handshake, which measured 2.1 to 2.8s against 1.26s warm (D17). The
 * compile rewrite pass has a 1500ms budget (invariant 11), so that first call always falls
 * back to the deterministic brief and the creator loses the rewrite.
 *
 * This spends one tiny call per provider at boot to pay that cost before a creator does. It is
 * best effort: a failure is logged and changes nothing, since every path already works without
 * the rewrite.
 */

/** Small enough to be free in practice: a few input tokens and a single output token. */
const WARM_REQUEST = { prompt: 'ok', maxOutputTokens: 1, reasoning: 'minimal' } as const;

/**
 * Generous, because this call is the slow one by definition: credentials, a token exchange and
 * a handshake. At 10s it timed out on a cold boot and reported a failure while doing the very
 * work it exists to do.
 */
const WARM_TIMEOUT_MS = 30_000;

async function warm(adapter: TextAdapter, log?: Logger): Promise<void> {
  const started = Date.now();
  try {
    await adapter.generate({ ...WARM_REQUEST, signal: AbortSignal.timeout(WARM_TIMEOUT_MS) });
    log?.info({ adapter: adapter.key, elapsedMs: Date.now() - started }, 'provider warmed');
  } catch (err) {
    log?.warn({ err, adapter: adapter.key }, 'provider warm up failed; first call will be cold');
  }
}

/**
 * Warms the rewrite providers, which are the only ones on a latency budget. Image and video
 * models are left cold on purpose: one picture costs real money, and nothing times them.
 * Fakes need no warming. Never rejects, so callers can leave it running in the background.
 */
export async function warmProviders(providers: Providers, log?: Logger): Promise<void> {
  if (providers.mode !== 'real') return;
  const unique = new Map(providers.rewriters.map((adapter) => [adapter.key, adapter]));
  await Promise.all([...unique.values()].map((adapter) => warm(adapter, log)));
}
