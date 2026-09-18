export interface TextRequest {
  /** Compiled by the orchestration engine. Adapters never add prompt text (invariant 4). */
  prompt: string;
  system?: string;
  /** Required: output costs 5 to 6 times input, so every generator sets a ceiling (plan section 6). */
  maxOutputTokens: number;
  temperature?: number;
  /** 'json' asks for a single JSON object, as the compile rewrite pass does. */
  format?: 'text' | 'json';
  /**
   * 'minimal' asks a reasoning model to think as little as it can, for latency bound calls
   * such as the compile rewrite pass. Providers without a reasoning setting ignore it.
   */
  reasoning?: 'minimal' | 'default';
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export type FinishReason = 'stop' | 'length' | 'safety' | 'other';

export interface TextResult {
  text: string;
  finishReason: FinishReason;
  usage: TokenUsage;
}

export type TextStreamEvent =
  { type: 'delta'; text: string } | { type: 'done'; result: TextResult };

export interface TextAdapter {
  readonly key: string;
  generate(request: TextRequest): Promise<TextResult>;
  /** Yields deltas, then exactly one `done` event carrying the full text and usage. */
  stream(request: TextRequest): AsyncIterable<TextStreamEvent>;
}
