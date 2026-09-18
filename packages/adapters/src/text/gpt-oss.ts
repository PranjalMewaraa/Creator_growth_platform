import type { Logger } from '@cgp/config';
import type {
  FinishReason,
  TextAdapter,
  TextRequest,
  TextResult,
  TextStreamEvent,
} from '@cgp/contracts';
import { GoogleAuth } from 'google-auth-library';
import { normalizeError } from '../errors';

export interface GptOssTextOptions {
  key: string;
  project: string;
  location: string;
  /** Vertex serves open models as a service under ids like `openai/gpt-oss-20b-maas`. */
  model: string;
  log?: Logger;
}

interface ChatChoice {
  message?: { content?: string | null };
  delta?: { content?: string | null };
  finish_reason?: string | null;
}

interface ChatResponse {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function finishReason(reason: string | null | undefined): FinishReason {
  if (reason === 'stop') return 'stop';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'safety';
  return 'other';
}

/** An HTTP failure shaped so normalizeError can read its status and headers. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly headers: Headers,
  ) {
    super(`HTTP ${status}`);
  }
}

/**
 * gpt-oss-20b as a service on Vertex, through Vertex's OpenAI-compatible chat endpoint. Pay per
 * token; nothing is deployed, so nothing bills while idle.
 */
export function createGptOssText(options: GptOssTextOptions): TextAdapter {
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const host =
    options.location === 'global'
      ? 'aiplatform.googleapis.com'
      : `${options.location}-aiplatform.googleapis.com`;
  const url = `https://${host}/v1/projects/${options.project}/locations/${options.location}/endpoints/openapi/chat/completions`;

  async function post(request: TextRequest, stream: boolean): Promise<Response> {
    const client = await auth.getClient();
    const headers = new Headers(await client.getRequestHeaders(url));
    headers.set('content-type', 'application/json');
    const response = await fetch(url, {
      method: 'POST',
      headers,
      signal: request.signal,
      body: JSON.stringify({
        model: options.model,
        max_tokens: request.maxOutputTokens,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.format === 'json' ? { response_format: { type: 'json_object' } } : {}),
        // Reasoning tokens count against max_tokens, so at 'minimal' the answer keeps the budget.
        ...(request.reasoning === 'minimal' ? { reasoning_effort: 'low' } : {}),
        messages: [
          ...(request.system ? [{ role: 'system', content: request.system }] : []),
          { role: 'user', content: request.prompt },
        ],
        ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
      }),
    });
    if (!response.ok) throw new HttpError(response.status, response.headers);
    return response;
  }

  function result(
    text: string,
    reason: string | null | undefined,
    usage: ChatResponse['usage'],
  ): TextResult {
    return {
      text,
      finishReason: finishReason(reason),
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      },
    };
  }

  return {
    key: options.key,

    async generate(request) {
      try {
        const body = (await (await post(request, false)).json()) as ChatResponse;
        const choice = body.choices?.[0];
        return result(choice?.message?.content ?? '', choice?.finish_reason, body.usage);
      } catch (err) {
        throw normalizeError('gpt-oss', err, options.log, request.signal);
      }
    },

    async *stream(request): AsyncIterable<TextStreamEvent> {
      try {
        const response = await post(request, true);
        if (!response.body) throw new Error('Streaming response had no body');
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let reason: string | null | undefined;
        let usage: ChatResponse['usage'];
        for await (const bytes of response.body as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(bytes, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const data = line.startsWith('data:') ? line.slice(5).trim() : '';
            if (!data || data === '[DONE]') continue;
            const chunk = JSON.parse(data) as ChatResponse;
            const choice = chunk.choices?.[0];
            const delta = choice?.delta?.content ?? '';
            if (delta) {
              text += delta;
              yield { type: 'delta', text: delta };
            }
            reason = choice?.finish_reason ?? reason;
            usage = chunk.usage ?? usage;
          }
        }
        yield { type: 'done', result: result(text, reason, usage) };
      } catch (err) {
        throw normalizeError('gpt-oss', err, options.log, request.signal);
      }
    },
  };
}
