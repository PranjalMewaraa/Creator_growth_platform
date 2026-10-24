import { isAdapterError } from '@cgp/contracts';
import { describe, expect, it } from 'vitest';
import { VOICE_MODEL_KEYS, voiceCostInr } from '../models';
import { createVoiceAdapters } from '../registry';
import { createGoogleVoice, segmentsToSsml } from './google';

const request = {
  segments: ['Plan it.', 'Make it.', 'Post it.'],
  voice: '',
  language: 'en' as const,
};

/** A Google voice whose call is answered from here, so nothing leaves the machine. */
function voiceWith(body: unknown, status = 200) {
  const calls: Array<Record<string, unknown>> = [];
  const adapter = createGoogleVoice({
    key: 'neural2-en-in',
    project: 'test-project',
    voice: 'en-IN-Neural2-A',
    language: 'en-IN',
    authHeaders: () => Promise.resolve({ authorization: 'Bearer test' }),
    fetch: ((_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body) as Record<string, unknown>);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }) as unknown as typeof fetch,
  });
  return { adapter, calls };
}

const audio = Buffer.from('fake-mp3').toString('base64');

/** A minimal 16-bit mono PCM WAV, the shape Google's LINEAR16 encoding returns. */
function wavOf(seconds: number, sampleRate = 24000): string {
  const samples = Math.round(seconds * sampleRate);
  const pcm = Buffer.alloc(samples * 2); // silence is fine; only the length is asserted
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString('base64');
}

/** A Chirp-shaped voice: one call per segment, LINEAR16, no marks. */
function chirpVoiceWith(secondsPerSegment: number[]) {
  const calls: Array<Record<string, unknown>> = [];
  let call = 0;
  const adapter = createGoogleVoice({
    key: 'chirp3-hd-en-in',
    project: 'test-project',
    voice: 'en-IN-Chirp3-HD-Achernar',
    language: 'en-IN',
    supportsTimepoints: false,
    authHeaders: () => Promise.resolve({ authorization: 'Bearer test' }),
    fetch: ((_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(body);
      const seconds = secondsPerSegment[call++] ?? 1;
      return Promise.resolve(
        new Response(JSON.stringify({ audioContent: wavOf(seconds) }), { status: 200 }),
      );
    }) as unknown as typeof fetch,
  });
  return { adapter, calls };
}

describe('segmentsToSsml', () => {
  it('marks every segment and the end, so each has a start and a finish', () => {
    const ssml = segmentsToSsml(['One.', 'Two.']);
    expect(ssml).toBe(
      '<speak><mark name="s0"/>One. <mark name="s1"/>Two. <mark name="end"/></speak>',
    );
  });

  it('escapes the script rather than letting it become markup', () => {
    expect(segmentsToSsml(['Tea & <biscuits>'])).toContain('Tea &amp; &lt;biscuits&gt;');
  });
});

describe('the Google voice', () => {
  it('asks for timepoints, without which captions would have to be transcribed', async () => {
    const { adapter, calls } = voiceWith({
      audioContent: audio,
      timepoints: [
        { markName: 's0', timeSeconds: 0 },
        { markName: 's1', timeSeconds: 1.4 },
        { markName: 's2', timeSeconds: 2.6 },
        { markName: 'end', timeSeconds: 3.9 },
      ],
    });
    const result = await adapter.synthesize(request);

    expect(calls[0]).toMatchObject({ enableTimePointing: ['SSML_MARK'] });
    expect(result.segmentStartsSeconds).toEqual([0, 1.4, 2.6]);
    expect(result.durationSeconds).toBe(3.9);
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('refuses a voice that ignores marks, rather than returning timings of zero', async () => {
    const { adapter } = voiceWith({ audioContent: audio, timepoints: [] });
    const err: unknown = await adapter.synthesize(request).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isAdapterError(err) && err.code).toBe('NO_TIMEPOINTS');
  });

  it('refuses an empty script', async () => {
    const { adapter } = voiceWith({ audioContent: audio });
    const err: unknown = await adapter.synthesize({ ...request, segments: ['', '  '] }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isAdapterError(err) && err.code).toBe('NO_SCRIPT');
  });

  it('maps HTTP status to what the caller should do', async () => {
    const { adapter } = voiceWith({ error: 'nope' }, 429);
    const err: unknown = await adapter.synthesize(request).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(isAdapterError(err) && err.category).toBe('quota');
  });
});

describe('a voice tier with no timepoints (Chirp 3 HD)', () => {
  it('synthesises one call per segment and times each from its own audio length', async () => {
    const { adapter, calls } = chirpVoiceWith([1, 2, 1.5]);
    const result = await adapter.synthesize(request);

    expect(calls).toHaveLength(3);
    expect(calls[0]).not.toHaveProperty('enableTimePointing');
    expect(calls[0]).toMatchObject({ input: { text: 'Plan it.' } });
    expect(result.segmentStartsSeconds).toEqual([0, 1, 3]);
    expect(result.durationSeconds).toBeCloseTo(4.5, 2);
    expect(result.mimeType).toBe('audio/wav');
  });

  it('produces one playable WAV with every segment’s PCM, in order', async () => {
    const { adapter } = chirpVoiceWith([1, 1]);
    const result = await adapter.synthesize({ ...request, segments: ['One.', 'Two.'] });

    const header = Buffer.from(result.data.buffer, result.data.byteOffset, 44);
    expect(header.toString('ascii', 0, 4)).toBe('RIFF');
    expect(header.toString('ascii', 8, 12)).toBe('WAVE');
    expect(header.toString('ascii', 36, 40)).toBe('data');
    // Two seconds of 24kHz mono 16-bit PCM, header excluded.
    expect(result.data.length - 44).toBe(24000 * 2 * 2);
  });
});

describe('voice cost', () => {
  it('prices a thirty second voiceover at what the spike measured', () => {
    // About 450 characters, Neural2 at USD 16 per million.
    expect(voiceCostInr('neural2-en-in', 450)).toBeCloseTo(0.63, 2);
  });
});

describe('the voice registry', () => {
  it('has one adapter per configured voice, in both modes', () => {
    expect(Object.keys(createVoiceAdapters('fake'))).toEqual([...VOICE_MODEL_KEYS]);
    expect(Object.keys(createVoiceAdapters('real', { project: 'p' }))).toEqual([
      ...VOICE_MODEL_KEYS,
    ]);
  });
});
