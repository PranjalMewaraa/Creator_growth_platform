import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// The one place ffmpeg is run (plan section 4.6). Arguments are passed as a list, never a
// shell string, so a filename with a space or a quote in it cannot become another argument.

const run = promisify(execFile);

/** A render is minutes of work; past this something is wrong and the job should end. */
export const RENDER_TIMEOUT_MS = 10 * 60_000;

/** ffmpeg writes everything to stderr, including progress, so only the tail is worth keeping. */
const KEPT_ERROR_LINES = 12;

export class RenderFailed extends Error {
  override readonly name = 'RenderFailed';
  constructor(
    readonly step: string,
    detail: string,
  ) {
    super(`ffmpeg could not ${step}: ${detail}`);
  }
}

export interface FfmpegOptions {
  /** The binary, from FFMPEG_PATH. A bare name is looked up on PATH. */
  bin: string;
  timeoutMs?: number;
  /**
   * x264's speed against size. `medium` is the default a delivered reel deserves; tests pass
   * `ultrafast`, because they are checking the graph rather than the compression.
   */
  preset?: string;
}

function tail(text: string): string {
  return text.trim().split('\n').slice(-KEPT_ERROR_LINES).join('\n');
}

/**
 * Runs one ffmpeg command. `-nostdin` because a worker has no console to answer prompts with,
 * and `-y` because every output here is a fresh temporary file.
 */
export async function ffmpeg(
  options: FfmpegOptions,
  step: string,
  args: string[],
): Promise<string> {
  try {
    const { stderr } = await run(options.bin, ['-hide_banner', '-nostdin', '-y', ...args], {
      timeout: options.timeoutMs ?? RENDER_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    return stderr;
  } catch (err) {
    const detail =
      (err as { stderr?: string }).stderr ?? (err instanceof Error ? err.message : String(err));
    throw new RenderFailed(step, tail(detail));
  }
}

/** Whether the configured ffmpeg exists and can run, checked once before a render starts. */
export async function ffmpegAvailable(options: FfmpegOptions): Promise<boolean> {
  try {
    await run(options.bin, ['-version'], { timeout: 10_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}
