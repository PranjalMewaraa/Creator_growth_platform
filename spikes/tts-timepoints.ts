// WP5 spike: which Google Cloud TTS voices return timepoints for caption segments?
// Captions come from the script, timed by the voice, never transcribed (invariant 13), so a
// voice tier without timepoints cannot drive captions. Throwaway (plan section 11, week 1).
//
//   node spikes/tts-timepoints.ts <output dir>
//
// Costs a fraction of a rupee (a few hundred characters per voice, inside the free tier).
// Auth from Application Default Credentials via gcloud; the token is never printed.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

process.loadEnvFile('.env');
const project = process.env.GOOGLE_CLOUD_PROJECT;
if (!project) throw new Error('GOOGLE_CLOUD_PROJECT is not set in .env');
const outDir = resolve(process.argv[2] ?? 'spike-output');
const LANGUAGE = 'en-IN';

// Caption segments, as a script would be split for the reel.
const SEGMENTS = [
  'Your content engine, in plain words.',
  'Plan it.',
  'Make it.',
  'Post it.',
  'Type what you want.',
  'We handle the prompt, the format and the schedule.',
];

function accessToken(): string {
  const gcloud = process.env.GCLOUD_PATH ?? 'gcloud';
  const result = spawnSync(`"${gcloud}" auth application-default print-access-token`, {
    encoding: 'utf8',
    shell: true,
  });
  const token = result.stdout.trim();
  if (result.status !== 0 || !token)
    throw new Error(`gcloud could not issue a token: ${result.stderr}`);
  return token;
}

const headers = {
  authorization: `Bearer ${accessToken()}`,
  'x-goog-user-project': project,
  'content-type': 'application/json',
};

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A mark before each segment and one at the end, so every segment has a start and an end.
const ssml = `<speak>${SEGMENTS.map((s, i) => `<mark name="s${i}"/>${escapeXml(s)} `).join('')}<mark name="end"/></speak>`;

interface Voice {
  name: string;
  ssmlGender: string;
  naturalSampleRateHertz: number;
}

const voicesResponse = await fetch(
  `https://texttospeech.googleapis.com/v1/voices?languageCode=${LANGUAGE}`,
  { headers },
);
if (!voicesResponse.ok) {
  throw new Error(`voices -> HTTP ${voicesResponse.status}: ${await voicesResponse.text()}`);
}
const { voices = [] } = (await voicesResponse.json()) as { voices?: Voice[] };

const TYPES = ['Standard', 'Wavenet', 'Neural2', 'Chirp3-HD', 'Chirp-HD', 'Studio'];
const typeOf = (name: string) => TYPES.find((t) => name.includes(`-${t}-`)) ?? 'other';

const counts = new Map<string, number>();
for (const v of voices) counts.set(typeOf(v.name), (counts.get(typeOf(v.name)) ?? 0) + 1);
console.log(
  `${voices.length} ${LANGUAGE} voices: ${[...counts].map(([t, n]) => `${t} ${n}`).join(', ')}`,
);

// One female voice per type where there is one, else the first of that type.
const picks = TYPES.map(
  (type) =>
    voices.find((v) => typeOf(v.name) === type && v.ssmlGender === 'FEMALE') ??
    voices.find((v) => typeOf(v.name) === type),
).filter((v): v is Voice => Boolean(v));

mkdirSync(outDir, { recursive: true });
console.log(
  `SSML input: ${ssml.length} characters (plain text alone: ${SEGMENTS.join(' ').length})`,
);

for (const voice of picks) {
  const started = Date.now();
  const response = await fetch('https://texttospeech.googleapis.com/v1beta1/text:synthesize', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { ssml },
      voice: { languageCode: LANGUAGE, name: voice.name },
      audioConfig: { audioEncoding: 'MP3' },
      enableTimePointing: ['SSML_MARK'],
    }),
  });
  const ms = Date.now() - started;
  if (!response.ok) {
    const message = ((await response.json()) as { error?: { message?: string } }).error?.message;
    console.log(`\n${voice.name}: HTTP ${response.status} in ${ms}ms: ${message}`);
    continue;
  }
  const body = (await response.json()) as {
    audioContent: string;
    timepoints?: Array<{ markName: string; timeSeconds?: number }>;
  };
  const file = join(outDir, `${voice.name}.mp3`);
  writeFileSync(file, Buffer.from(body.audioContent, 'base64'));
  const marks = body.timepoints ?? [];
  console.log(
    `\n${voice.name} (${voice.ssmlGender}): ${ms}ms, ${marks.length} timepoints, saved ${file}`,
  );
  // Segment windows as captions would use them: this segment's mark to the next one.
  SEGMENTS.forEach((segment, i) => {
    const start = marks.find((m) => m.markName === `s${i}`)?.timeSeconds;
    const end = marks.find(
      (m) => m.markName === (i + 1 < SEGMENTS.length ? `s${i + 1}` : 'end'),
    )?.timeSeconds;
    if (start !== undefined || end !== undefined) {
      console.log(`  ${(start ?? 0).toFixed(2)}s to ${end?.toFixed(2) ?? '?'}s  ${segment}`);
    }
  });
}
