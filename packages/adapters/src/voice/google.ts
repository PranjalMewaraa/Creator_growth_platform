import type { Logger } from '@cgp/config';
import { AdapterError, type VoiceAdapter, type VoiceResult } from '@cgp/contracts';
import { GoogleAuth } from 'google-auth-library';
import { categoryForStatus, normalizeError } from '../errors';

// Google Cloud Text to Speech (WP23, plan section 6). The script is sent as SSML with a mark
// before each caption segment and one at the end, and the marks come back with times: that is
// how captions are timed by the voice rather than transcribed from the render (invariant 13).
//
// The WP5 spike settled the tier: Standard, WaveNet and Neural2 return timepoints; Chirp 3 HD
// returns audio and no timepoints, so it cannot drive captions (docs/spikes/tts.md).

const ENDPOINT = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';

export interface GoogleVoiceOptions {
  key: string;
  project: string;
  /** A voice id from the rate card, such as `en-IN-Neural2-A`. */
  voice: string;
  language: string;
  log?: Logger;
  /** Tests pass a fetch that never leaves the machine, and auth that needs no login. */
  fetch?: typeof fetch;
  authHeaders?: (url: string) => Promise<ConstructorParameters<typeof Headers>[0]>;
}

interface SynthesiseResponse {
  audioContent?: string;
  timepoints?: Array<{ markName?: string; timeSeconds?: number }>;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A mark before every segment and one at the end, so each segment has a start and an end. */
export function segmentsToSsml(segments: string[]): string {
  const body = segments
    .map((segment, i) => `<mark name="s${i}"/>${escapeXml(segment.trim())} `)
    .join('');
  return `<speak>${body}<mark name="end"/></speak>`;
}

export function createGoogleVoice(options: GoogleVoiceOptions): VoiceAdapter {
  const doFetch = options.fetch ?? fetch;
  const authHeaders =
    options.authHeaders ??
    (() => {
      const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
      return async (url: string) => (await auth.getClient()).getRequestHeaders(url);
    })();

  return {
    key: options.key,

    async synthesize(request): Promise<VoiceResult> {
      const segments = request.segments.map((segment) => segment.trim()).filter(Boolean);
      if (segments.length === 0) {
        throw new AdapterError({
          code: 'NO_SCRIPT',
          message: 'a voiceover needs something to say',
          category: 'terminal',
        });
      }

      try {
        const headers = new Headers(await authHeaders(ENDPOINT));
        headers.set('x-goog-user-project', options.project);
        headers.set('content-type', 'application/json');
        const response = await doFetch(ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            input: { ssml: segmentsToSsml(segments) },
            voice: { languageCode: options.language, name: request.voice || options.voice },
            audioConfig: {
              audioEncoding: 'MP3',
              ...(request.speakingRate === undefined ? {} : { speakingRate: request.speakingRate }),
            },
            // Without this the marks come back silently ignored, and captions would have to be
            // transcribed, which invariant 13 forbids.
            enableTimePointing: ['SSML_MARK'],
          }),
        });
        if (!response.ok) {
          options.log?.warn(
            { provider: 'google-tts', status: response.status },
            'provider call failed',
          );
          throw new AdapterError({
            code: `HTTP_${response.status}`,
            message: `google-tts request failed with HTTP ${response.status}`,
            category: categoryForStatus(response.status),
          });
        }

        const body = (await response.json()) as SynthesiseResponse;
        if (!body.audioContent) {
          throw new AdapterError({
            code: 'NO_AUDIO',
            message: 'google-tts returned no audio',
            category: 'retriable',
          });
        }
        const at = (mark: string): number | undefined =>
          body.timepoints?.find((point) => point.markName === mark)?.timeSeconds;
        const starts = segments.map((_, i) => at(`s${i}`) ?? 0);
        // A voice tier that ignores marks cannot time captions, which is the one thing this
        // is for. Better to refuse than to hand back timings that are all zero.
        if (segments.length > 1 && starts.every((start) => start === 0)) {
          throw new AdapterError({
            code: 'NO_TIMEPOINTS',
            message: `${request.voice || options.voice} returned no timepoints`,
            category: 'terminal',
          });
        }
        return {
          data: new Uint8Array(Buffer.from(body.audioContent, 'base64')),
          mimeType: 'audio/mpeg',
          durationSeconds: at('end') ?? starts.at(-1) ?? 0,
          segmentStartsSeconds: starts,
        };
      } catch (err) {
        throw normalizeError('google-tts', err, options.log);
      }
    },
  };
}
