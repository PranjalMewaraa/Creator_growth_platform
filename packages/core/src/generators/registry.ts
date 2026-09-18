import type {
  CreditEstimate,
  GeneratorDefinition,
  JobClass,
  MeteringRates,
  OutputType,
} from '@cgp/contracts';

export interface InputIssue {
  path: string;
  message: string;
}

export type Prepared =
  { ok: true; input: unknown; estimate: CreditEstimate } | { ok: false; issues: InputIssue[] };

/**
 * A definition with its input type erased, so definitions of different inputs sit in one
 * registry. Parsing and pricing happen together, so an estimate always prices parsed input.
 */
export interface RegisteredGenerator {
  key: string;
  outputType: OutputType;
  jobClass: Exclude<JobClass, 'publish'>;
  compilerProfile: string;
  providerAdapter: string;
  prepare(raw: unknown, rates: MeteringRates): Prepared;
}

export function register<TInput>(definition: GeneratorDefinition<TInput>): RegisteredGenerator {
  const { key, outputType, jobClass, compilerProfile, providerAdapter } = definition;
  return {
    key,
    outputType,
    jobClass,
    compilerProfile,
    providerAdapter,
    prepare(raw, rates) {
      const parsed = definition.inputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        };
      }
      return { ok: true, input: parsed.data, estimate: definition.estimate(parsed.data, rates) };
    },
  };
}

export interface GeneratorRegistry {
  get(key: string): RegisteredGenerator | undefined;
  list(): RegisteredGenerator[];
}

/** Adding a generator is one entry here; the API routes look generators up by key (FR-GN-02). */
export function createGeneratorRegistry(generators: RegisteredGenerator[]): GeneratorRegistry {
  const byKey = new Map<string, RegisteredGenerator>();
  for (const generator of generators) {
    if (!/^[a-z][a-z0-9_]*$/.test(generator.key)) {
      throw new Error(`Generator key "${generator.key}" must be lower snake case`);
    }
    if (byKey.has(generator.key)) {
      throw new Error(`Generator "${generator.key}" is registered twice`);
    }
    byKey.set(generator.key, generator);
  }
  return {
    get: (key) => byKey.get(key),
    list: () => [...byKey.values()],
  };
}

/**
 * The rate for an action class. A missing rate is a configuration error, never a free action:
 * pricing at 0 by accident would give the work away.
 */
export function rateFor(rates: MeteringRates, actionClass: string): number {
  const rate = rates.credits[actionClass];
  if (rate === undefined) {
    throw new Error(`Metering rates v${rates.version} have no rate for "${actionClass}"`);
  }
  return rate;
}
