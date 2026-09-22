/**
 * Bitrate ladder (spec 09 §2).
 *
 * maxrate is 110% of the target and bufsize is 2x — constrained VBR, which
 * keeps the stream predictable enough for the player's ABR estimator while
 * still letting complex scenes spend bits.
 */
export interface Rung {
  name: string;
  width: number;
  height: number;
  bitrateKbps: number;
  maxrateKbps: number;
  bufsizeKbps: number;
  profile: 'high' | 'main';
  cq: number;
}

export const LADDER: readonly Rung[] = [
  { name: '1080p', width: 1920, height: 1080, bitrateKbps: 5000, maxrateKbps: 5500, bufsizeKbps: 10000, profile: 'high', cq: 23 },
  { name: '720p',  width: 1280, height: 720,  bitrateKbps: 3000, maxrateKbps: 3300, bufsizeKbps: 6000,  profile: 'high', cq: 23 },
  { name: '480p',  width: 854,  height: 480,  bitrateKbps: 1500, maxrateKbps: 1650, bufsizeKbps: 3000,  profile: 'main', cq: 25 },
  { name: '360p',  width: 640,  height: 360,  bitrateKbps: 800,  maxrateKbps: 880,  bufsizeKbps: 1600,  profile: 'main', cq: 27 },
] as const;

export const AUDIO_BITRATE_KBPS = 128;

export interface SourceDimensions {
  width: number;
  height: number;
}

/**
 * BR-024 — never upscale. The ladder is truncated at the source resolution,
 * and 4K sources are still capped at 1080p in v1.
 *
 * Orientation matters: for a portrait source the long edge is the width of
 * the rung, so a 1080x1920 clip earns the full ladder rather than being
 * judged as "360p tall".
 */
export function buildLadder(source: SourceDimensions): Rung[] {
  const longEdge = Math.max(source.width, source.height);
  const portrait = source.height > source.width;

  const rungs = LADDER.filter((r) => r.width <= longEdge);
  // A source smaller than the lowest rung still gets exactly one rendition.
  const selected = rungs.length > 0 ? rungs : [LADDER[LADDER.length - 1]!];

  if (!portrait) return selected.map((r) => ({ ...r }));

  // Swap the axes and keep the aspect ratio of the source, rounding to even
  // numbers — H.264 refuses odd dimensions.
  const aspect = source.width / source.height;
  return selected.map((rung) => ({
    ...rung,
    width: rung.height,
    height: even(Math.round(rung.height / aspect)),
  }));
}

const even = (n: number) => (n % 2 === 0 ? n : n + 1);

/** `scale_cuda` expression that fixes the constrained edge and lets FFmpeg
 *  derive the other one (-2 keeps it divisible by two). */
export function scaleFilter(rung: Rung, portrait: boolean): string {
  return portrait
    ? `scale_cuda=w=${rung.width}:h=-2:format=yuv420p`
    : `scale_cuda=w=-2:h=${rung.height}:format=yuv420p`;
}
