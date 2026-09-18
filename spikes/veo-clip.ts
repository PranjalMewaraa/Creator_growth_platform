// WP5 spike: generate one Veo 3.1 Lite clip on Vertex and read what it costs.
// Throwaway by design (plan section 11, week 1). The real adapter is WP21.
//
//   node spikes/veo-clip.ts <output dir>
//
// Spends trial credit: one 8 second 1080p clip, about INR 35 if Veo bills per second.
// Auth comes from Application Default Credentials via gcloud; no key file, token never printed.
// GCLOUD_PATH overrides the gcloud executable; FFMPEG_PATH, if set, is used to inspect the clip.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

process.loadEnvFile('.env');
const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
if (!project) throw new Error('GOOGLE_CLOUD_PROJECT is not set in .env');

const MODEL = 'veo-3.1-lite-generate-001';
const outDir = resolve(process.argv[2] ?? 'spike-output');

// Invariant 12: the video model never renders text. Scene only; captions are composited later.
const PROMPT =
  'Slow cinematic push-in on a steaming cup of masala chai on a wooden table beside a window, ' +
  'soft morning sunlight, gentle rising steam, shallow depth of field, warm tones, vertical frame.';
const NEGATIVE = 'text, captions, letters, watermark, logo, subtitles';

function accessToken(): string {
  const gcloud = process.env.GCLOUD_PATH ?? 'gcloud';
  // shell: gcloud is a .cmd on Windows, which only runs through a shell.
  const result = spawnSync(`"${gcloud}"`, ['auth', 'application-default', 'print-access-token'], {
    encoding: 'utf8',
    shell: true,
  });
  const token = result.stdout.trim();
  if (result.status !== 0 || !token)
    throw new Error(`gcloud could not issue a token: ${result.stderr}`);
  return token;
}

const token = accessToken();
const base = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${MODEL}`;

async function post<T>(action: string, body: unknown): Promise<T> {
  const response = await fetch(`${base}:${action}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'x-goog-user-project': project!,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${action} -> HTTP ${response.status}: ${text.slice(0, 2000)}`);
  return JSON.parse(text) as T;
}

const elapsed = (since: number) => `${((Date.now() - since) / 1000).toFixed(1)}s`;

const started = Date.now();
const operation = await post<{ name: string }>('predictLongRunning', {
  instances: [{ prompt: PROMPT }],
  parameters: {
    aspectRatio: '9:16',
    durationSeconds: 8,
    resolution: '1080p',
    sampleCount: 1,
    negativePrompt: NEGATIVE,
    // The first run left this unset and got a generated soundtrack, so it was probably billed
    // at the audio rate. The plan prices video only; voiceover and music are added in the render.
    // Not yet confirmed that the model accepts it: check on the next generation.
    generateAudio: false,
  },
});
console.log(`Submitted ${MODEL}: ${operation.name.split('/').pop()}`);

interface Operation {
  done?: boolean;
  error?: { code: number; message: string };
  response?: {
    raiMediaFilteredCount?: number;
    raiMediaFilteredReasons?: string[];
    videos?: Array<{ bytesBase64Encoded?: string; gcsUri?: string; mimeType?: string }>;
  };
}

let result: Operation = {};
while (!result.done && Date.now() - started < 10 * 60_000) {
  await new Promise((r) => setTimeout(r, 10_000));
  result = await post<Operation>('fetchPredictOperation', { operationName: operation.name });
  if (!result.done) console.log(`  still generating after ${elapsed(started)}`);
}
if (!result.done) throw new Error(`Not finished after ${elapsed(started)}`);
if (result.error)
  throw new Error(`Generation failed: ${result.error.code} ${result.error.message}`);

const filtered = result.response?.raiMediaFilteredCount ?? 0;
if (filtered > 0) {
  console.log(
    `Safety filter removed ${filtered}: ${result.response?.raiMediaFilteredReasons?.join('; ')}`,
  );
}
const video = result.response?.videos?.[0];
if (!video?.bytesBase64Encoded) {
  throw new Error(`No inline video returned: ${JSON.stringify(result.response).slice(0, 500)}`);
}

mkdirSync(outDir, { recursive: true });
const file = join(outDir, 'veo-clip.mp4');
const bytes = Buffer.from(video.bytesBase64Encoded, 'base64');
writeFileSync(file, bytes);
console.log(`Done in ${elapsed(started)}: ${file} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);

if (process.env.FFMPEG_PATH) {
  const probe = spawnSync(process.env.FFMPEG_PATH, ['-hide_banner', '-i', file], {
    encoding: 'utf8',
  });
  console.log(
    probe.stderr
      .split('\n')
      .filter((line) => /Duration|Stream/.test(line))
      .join('\n'),
  );
}
