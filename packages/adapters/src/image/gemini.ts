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
import { imageSize } from './size';

export interface GeminiImageOptions {
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
    const response = await ai.models.generateContent({
      model: options.model,
      contents: request.prompt,
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

  return {
    key: options.key,

    async generate(request) {
      try {
        // One at a time, not in parallel. The image quota is metered per minute and a burst of
        // three trips it every time, which costs the whole set: a thumbnail set is refused
        // outright rather than taking a few seconds longer.
        const results: Array<Awaited<ReturnType<typeof one>>> = [];
        for (let i = 0; i < request.count; i++) results.push(await one(request));
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
