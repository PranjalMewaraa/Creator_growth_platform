import type { Logger } from '@cgp/config';
import { AdapterError, type VoiceAdapter, type VoiceResult } from '@cgp/contracts';
import { createGoogleAuth } from '../google-auth';
import { categoryForStatus, normalizeError } from '../errors';

// Google Cloud Text to Speech (WP23, plan section 6). The script is sent as SSML with a mark
// before each caption segment and one at the end, and the marks come back with times: that is
// how captions are timed by the voice rather than transcribed from the render (invariant 13).
//
// The WP5 spike settled the tier: Standard, WaveNet and Neural2 return timepoints; Chirp 3 HD
// returns audio and no timepoints, so it cannot drive captions (docs/spikes/tts.md) — not
// through this path. `supportsTimepoints: false` (WP68) routes a voice like that through
// synthesizeInSegments below instead: each caption segment synthesised on its own call, timed
// by its own audio length rather than a mark. Same character cost per the spike, just one call
// per segment instead of one call total.

const ENDPOINT = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const SAMPLE_RATE = 24000;

export interface GoogleVoiceOptions {
  key: string;
  project: string;
  /** A voice id from the rate card, such as `en-IN-Neural2-A`. */
  voice: string;
  language: string;
  /** False for a voice tier that never returns SSML-mark timepoints (WP68). Defaults true. */
  supportsTimepoints?: boolean;
  log?: Logger;
  /** Base64'd service-account JSON, for hosts with no filesystem (Vercel). */
  credentialsB64?: string;
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

/** A WAV file's `data` chunk and the format needed to time it, read out of its header. */
function readWav(bytes: Uint8Array): { pcm: Uint8Array; sampleRate: number; blockAlign: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12; // past "RIFF"<size>"WAVE"
  let sampleRate = SAMPLE_RATE;
  let blockAlign = 2;
  let pcm: Uint8Array | undefined;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
    } else if (id === 'data') {
      pcm = bytes.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!pcm) throw new Error('google-tts LINEAR16 response had no data chunk');
  return { pcm, sampleRate, blockAlign };
}

/** A WAV header around PCM already in the shape Google's LINEAR16 encoding returns it. */
function wrapWav(pcm: Uint8Array, sampleRate: number, blockAlign: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const str = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  const channels = blockAlign >= 4 ? 2 : 1;
  const bitsPerSample = (blockAlign / channels) * 8;
  str(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  str(36, 'data');
  view.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export function createGoogleVoice(options: GoogleVoiceOptions): VoiceAdapter {
  const doFetch = options.fetch ?? fetch;
  const authHeaders =
    options.authHeaders ??
    (() => {
      const auth = createGoogleAuth(
        'https://www.googleapis.com/auth/cloud-platform',
        options.credentialsB64,
      );
      return async (url: string) => (await auth.getClient()).getRequestHeaders(url);
    })();

  async function call(body: unknown): Promise<SynthesiseResponse> {
    const headers = new Headers(await authHeaders(ENDPOINT));
    headers.set('x-goog-user-project', options.project);
    headers.set('content-type', 'application/json');
    const response = await doFetch(ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
      options.log?.warn({ provider: 'google-tts', status: response.status }, 'provider call failed');
      throw new AdapterError({
        code: `HTTP_${response.status}`,
        message: `google-tts request failed with HTTP ${response.status}`,
        category: categoryForStatus(response.status),
      });
    }
    return (await response.json()) as SynthesiseResponse;
  }

  /** One call per segment, each timed by its own synthesised audio length rather than a mark —
   *  the WP5 spike's documented workaround for a voice tier that ignores SSML marks. */
  async function synthesizeInSegments(
    segments: string[],
    voice: string,
    speakingRate: number | undefined,
  ): Promise<VoiceResult> {
    const starts: number[] = [];
    const pcmParts: Uint8Array[] = [];
    let elapsed = 0;
    let sampleRate = SAMPLE_RATE;
    let blockAlign = 2;
    for (const segment of segments) {
      const body = await call({
        input: { text: segment },
        voice: { languageCode: options.language, name: voice },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: SAMPLE_RATE,
          ...(speakingRate === undefined ? {} : { speakingRate }),
        },
      });
      if (!body.audioContent) {
        throw new AdapterError({
          code: 'NO_AUDIO',
          message: 'google-tts returned no audio',
          category: 'retriable',
        });
      }
      const wav = readWav(new Uint8Array(Buffer.from(body.audioContent, 'base64')));
      sampleRate = wav.sampleRate;
      blockAlign = wav.blockAlign;
      starts.push(elapsed);
      pcmParts.push(wav.pcm);
      elapsed += wav.pcm.length / (sampleRate * blockAlign);
    }
    const pcm = new Uint8Array(pcmParts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of pcmParts) {
      pcm.set(part, at);
      at += part.length;
    }
    return {
      data: wrapWav(pcm, sampleRate, blockAlign),
      mimeType: 'audio/wav',
      durationSeconds: Number(elapsed.toFixed(2)),
      segmentStartsSeconds: starts,
    };
  }

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
      const voice = request.voice || options.voice;

      try {
        if (options.supportsTimepoints === false) {
          return await synthesizeInSegments(segments, voice, request.speakingRate);
        }

        const body = await call({
          input: { ssml: segmentsToSsml(segments) },
          voice: { languageCode: options.language, name: voice },
          audioConfig: {
            audioEncoding: 'MP3',
            ...(request.speakingRate === undefined ? {} : { speakingRate: request.speakingRate }),
          },
          // Without this the marks come back silently ignored, and captions would have to be
          // transcribed, which invariant 13 forbids.
          enableTimePointing: ['SSML_MARK'],
        });
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
            message: `${voice} returned no timepoints`,
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
