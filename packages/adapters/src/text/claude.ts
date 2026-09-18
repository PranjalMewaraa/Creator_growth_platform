import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import type { Logger } from '@cgp/config';
import type { FinishReason, TextAdapter, TextRequest, TextStreamEvent } from '@cgp/contracts';
import { normalizeError } from '../errors';

export interface ClaudeTextOptions {
  key: string;
  project: string;
  /** `global` is Anthropic's recommended Vertex region. */
  region: string;
  /** On Vertex, dated snapshots use `@`: `claude-haiku-4-5@20251001`. */
  model: string;
  log?: Logger;
}

type ClaudeMessage = Awaited<ReturnType<AnthropicVertex['messages']['create']>>;

function finishReason(stop: string | null | undefined): FinishReason {
  if (stop === 'end_turn' || stop === 'stop_sequence') return 'stop';
  if (stop === 'max_tokens') return 'length';
  if (stop === 'refusal') return 'safety';
  return 'other';
}

function text(message: ClaudeMessage): string {
  if (!('content' in message)) return '';
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
}

/**
 * Claude through Vertex, for scripts (plan section 6). `format: 'json'` has no native switch
 * here without a schema, so the compiled prompt has to ask for JSON itself; adapters never
 * add prompt text of their own (invariant 4).
 */
export function createClaudeText(options: ClaudeTextOptions): TextAdapter {
  const client = new AnthropicVertex({ projectId: options.project, region: options.region });

  const body = (request: TextRequest) => ({
    model: options.model,
    max_tokens: request.maxOutputTokens,
    ...(request.system ? { system: request.system } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    messages: [{ role: 'user' as const, content: request.prompt }],
  });

  return {
    key: options.key,

    async generate(request) {
      try {
        const message = await client.messages.create(body(request), { signal: request.signal });
        if (!('usage' in message)) throw new Error('Expected a complete message, got a stream');
        return {
          text: text(message),
          finishReason: finishReason(message.stop_reason),
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            ...(message.usage.cache_read_input_tokens
              ? { cachedInputTokens: message.usage.cache_read_input_tokens }
              : {}),
          },
        };
      } catch (err) {
        throw normalizeError('claude', err, options.log, request.signal);
      }
    },

    async *stream(request): AsyncIterable<TextStreamEvent> {
      try {
        const stream = client.messages.stream(body(request), { signal: request.signal });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield { type: 'delta', text: event.delta.text };
          }
        }
        const final = await stream.finalMessage();
        yield {
          type: 'done',
          result: {
            text: text(final),
            finishReason: finishReason(final.stop_reason),
            usage: {
              inputTokens: final.usage.input_tokens,
              outputTokens: final.usage.output_tokens,
              ...(final.usage.cache_read_input_tokens
                ? { cachedInputTokens: final.usage.cache_read_input_tokens }
                : {}),
            },
          },
        };
      } catch (err) {
        throw normalizeError('claude', err, options.log, request.signal);
      }
    },
  };
}
