/**
 * Keyframe alignment (spec 09 §3) — the single most important detail in the
 * pipeline. Every rendition must place its IDR frames at identical
 * timestamps, otherwise an ABR switch stutters or drops audio.
 *
 * GOP = frame_rate x segment length, and FFmpeg must be told four separate
 * times not to think for itself:
 *   -g N  -keyint_min N  -sc_threshold 0  -forced-idr 1
 */
export const SEGMENT_SECONDS = 4;

/**
 * Fractional rates are rounded to the nearest integer GOP: 23.976 x 4 = 95.9
 * rounds to 96, which is what the reference table in spec 09 §3.2 lists.
 */
export function gopForFrameRate(
  frameRate: number,
  segmentSeconds: number = SEGMENT_SECONDS,
): number {
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    throw new RangeError(`invalid frame rate: ${frameRate}`);
  }
  return Math.round(frameRate * segmentSeconds);
}

/** ffprobe reports rates as "24000/1001". */
export function parseFrameRate(raw: string): number {
  const [num, den] = raw.split("/");
  const n = Number(num);
  const d = den === undefined ? 1 : Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) {
    throw new RangeError(`unparseable frame rate: ${raw}`);
  }
  return n / d;
}

export const KEYFRAME_ARGS = (gop: number): string[] => [
  "-g",
  String(gop),
  "-keyint_min",
  String(gop),
  "-sc_threshold",
  "0",
  // NVENC-specific: without this it may emit plain I-frames, which a player
  // cannot start decoding from — the segment is silently unusable.
  "-forced-idr",
  "1",
];
