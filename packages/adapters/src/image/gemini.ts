import type { Logger } from '@cgp/config';
import {
  AdapterError,
  type GeneratedImage,
  type ImageAdapter,
  type ImageRequest,
  type TokenUsage,
} from '@cgp/contracts';
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import { normalizeError } from '../errors';
import { createPacer } from '../pace';
import { imageSize } from './size';

export interface GeminiImageOptions {
  /**
   * Calls a minute the provider allows, from the model's capability (WP36, WP40). Without one
   * the safe assumption is the limit this project actually has.
   */
  requestsPerMinute?: number;
  key: string;
  project: string;
  /** Gemini image models answer on `global` (checked 2026-09-24, D18). */
  location: string;
  model: string;
  log?: Logger;
}

const SAFETY = new Set([
  'SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
  'IMAGE_SAFETY',
]);

/** A picture the model refused to draw. Terminal: the same prompt will be refused again. */
function blocked(model: string, reason: string): AdapterError {
  return new AdapterError({
    code: 'SAFETY_BLOCKED',
    message: `${model} refused the prompt (${reason})`,
    category: 'terminal',
  });
}

function usageOf(responses: GenerateContentResponse[]): TokenUsage {
  return responses.reduce<TokenUsage>(
    (total, response) => ({
      inputTokens: total.inputTokens + (response.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: total.outputTokens + (response.usageMetadata?.candidatesTokenCount ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}

/**
 * Images through Vertex (never AI Studio, which bills the card rather than the credit). One
 * call returns one picture, so a request for several is that many calls, run together.
 */
export function createGeminiImage(options: GeminiImageOptions): ImageAdapter {
  const ai = new GoogleGenAI({
    vertexai: true,
    project: options.project,
    location: options.location,
  });

  async function one(request: ImageRequest): Promise<[GeneratedImage, GenerateContentResponse]> {
    // Pictures first, then the words: the model reads the parts in order, and a reference
    // offered after the instruction is a weaker anchor than one offered before it (WP39).
    const contents = request.references?.length
      ? [
          {
            role: 'user',
            parts: [
              ...request.references.map((reference) => ({
                inlineData: {
                  data: Buffer.from(reference.data).toString('base64'),
                  mimeType: reference.mimeType,
                },
              })),
              { text: request.prompt },
            ],
          },
        ]
      : request.prompt;

    const response = await ai.models.generateContent({
      model: options.model,
      contents,
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: request.aspectRatio },
        ...(request.seed === undefined ? {} : { seed: request.seed }),
        ...(request.signal ? { abortSignal: request.signal } : {}),
      },
    });

    const candidate = response.candidates?.[0];
    const inline = candidate?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!inline?.data) {
      const reason = response.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no image';
      if (SAFETY.has(reason)) throw blocked(options.model, reason);
      throw new AdapterError({
        code: 'NO_IMAGE',
        message: `${options.model} returned no image (${reason})`,
        category: 'retriable',
      });
    }

    const data = Buffer.from(inline.data, 'base64');
    // Unmeasurable bytes are still a usable picture, so the size is reported as unknown
    // rather than failing the job over it.
    const size = imageSize(data);
    if (!size) options.log?.warn({ model: options.model }, 'image size could not be read');
    return [
      {
        data: new Uint8Array(data),
        mimeType: inline.mimeType ?? 'image/png',
        width: size?.width ?? 0,
        height: size?.height ?? 0,
      },
      response,
    ];
  }

  /** What the provider says when the minute's allowance is spent. */
  const isQuotaError = (err: unknown): boolean => {
    const status = (err as { status?: number } | null)?.status;
    const message = err instanceof Error ? err.message : String(err);
    return status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED');
  };
  const pacer = createPacer({
    perMinute: options.requestsPerMinute ?? 2,
    isQuotaError,
  });

  return {
    key: options.key,

    async generate(request) {
      try {
        // One at a time, not in parallel, and paced: Vertex allows two of these a minute for
        // this project and a burst of three trips it every time, which costs the whole set
        // rather than a few seconds. The pacer lets the first two straight through and holds
        // the third until the window has room (WP40).
        const results: Array<Awaited<ReturnType<typeof one>>> = [];
        for (let i = 0; i < request.count; i++) results.push(await pacer.run(() => one(request)));
        return {
          images: results.map(([image]) => image),
          usage: usageOf(results.map(([, response]) => response)),
        };
      } catch (err) {
        throw normalizeError('gemini', err, options.log, request.signal);
      }
    },
  };
}
