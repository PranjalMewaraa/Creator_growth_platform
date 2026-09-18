import type { Logger } from '@cgp/config';
import type {
  FinishReason,
  TextAdapter,
  TextRequest,
  TextResult,
  TextStreamEvent,
} from '@cgp/contracts';
import { GoogleGenAI, ThinkingLevel, type GenerateContentResponse } from '@google/genai';
import { normalizeError } from '../errors';

export interface GeminiTextOptions {
  key: string;
  project: string;
  /** Gemini 3.x answers only on `global` (checked 2026-09-18, D10). */
  location: string;
  model: string;
  log?: Logger;
}

const SAFETY = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

function finishReason(reason: string | undefined): FinishReason {
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  if (reason && SAFETY.has(reason)) return 'safety';
  return 'other';
}

function result(text: string, response: GenerateContentResponse | undefined): TextResult {
  const usage = response?.usageMetadata;
  return {
    text,
    finishReason: finishReason(response?.candidates?.[0]?.finishReason),
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output, so they count toward cost.
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      ...(usage?.cachedContentTokenCount
        ? { cachedInputTokens: usage.cachedContentTokenCount }
        : {}),
    },
  };
}

/** Gemini through Vertex (never AI Studio, which bills the card rather than the credit). */
export function createGeminiText(options: GeminiTextOptions): TextAdapter {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: options.project,
    location: options.location,
  });

  const params = (request: TextRequest) => ({
    model: options.model,
    contents: request.prompt,
    config: {
      maxOutputTokens: request.maxOutputTokens,
      ...(request.system ? { systemInstruction: request.system } : {}),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.format === 'json' ? { responseMimeType: 'application/json' } : {}),
      ...(request.reasoning === 'minimal'
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
        : {}),
      ...(request.signal ? { abortSignal: request.signal } : {}),
    },
  });

  return {
    key: options.key,

    async generate(request) {
      try {
        const response = await ai.models.generateContent(params(request));
        return result(response.text ?? '', response);
      } catch (err) {
        throw normalizeError('gemini', err, options.log, request.signal);
      }
    },

    async *stream(request): AsyncIterable<TextStreamEvent> {
      try {
        const chunks = await ai.models.generateContentStream(params(request));
        let text = '';
        let last: GenerateContentResponse | undefined;
        for await (const chunk of chunks) {
          const delta = chunk.text ?? '';
          if (delta) {
            text += delta;
            yield { type: 'delta', text: delta };
          }
          last = chunk;
        }
        yield { type: 'done', result: result(text, last) };
      } catch (err) {
        throw normalizeError('gemini', err, options.log, request.signal);
      }
    },
  };
}
