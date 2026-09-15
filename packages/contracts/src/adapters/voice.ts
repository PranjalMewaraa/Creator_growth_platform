import type { LanguageCode, MediaBytes } from '../media';

export interface VoiceRequest {
  /**
   * The script split into caption segments. Timings come back per segment, which is how
   * captions come from the script rather than from transcribing the render (invariant 13).
   */
  segments: string[];
  /** Voice id from config. */
  voice: string;
  language: LanguageCode;
  speakingRate?: number;
}

export type VoiceResult = MediaBytes & {
  durationSeconds: number;
  /** Start time of each segment in seconds, in request order. */
  segmentStartsSeconds: number[];
};

export interface VoiceAdapter {
  readonly key: string;
  synthesize(request: VoiceRequest): Promise<VoiceResult>;
}
