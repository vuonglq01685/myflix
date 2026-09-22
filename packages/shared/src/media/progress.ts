/**
 * Parser for `ffmpeg -progress pipe:1 -nostats`, which emits key=value lines
 * terminated by `progress=continue` (or `progress=end`).
 */
export interface FfmpegProgress {
  frame?: number;
  fps?: number;
  /** Microseconds. FFmpeg's `out_time_ms` key is misnamed and also holds
   *  microseconds — read `out_time_us` and avoid the trap entirely. */
  outTimeUs?: number;
  speed?: number;
  totalSize?: number;
  done: boolean;
}

export function parseProgressChunk(chunk: string): FfmpegProgress | null {
  const fields = new Map<string, string>();
  for (const line of chunk.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  if (!fields.has('progress')) return null;

  const num = (key: string) => {
    const raw = fields.get(key);
    if (raw === undefined || raw === 'N/A') return undefined;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    frame: num('frame'),
    fps: num('fps'),
    outTimeUs: num('out_time_us'),
    // "8.62x" -> 8.62
    speed: num('speed') ?? (() => {
      const raw = fields.get('speed');
      if (!raw) return undefined;
      const parsed = Number.parseFloat(raw.replace('x', ''));
      return Number.isFinite(parsed) ? parsed : undefined;
    })(),
    totalSize: num('total_size'),
    done: fields.get('progress') === 'end',
  };
}

/** Clamped to 0..100: a source whose container duration lies would otherwise
 *  report 140% and blow the `ck_percent_range` CHECK. */
export function computePercent(outTimeUs: number | undefined, durationSec: number): number {
  if (!outTimeUs || durationSec <= 0) return 0;
  const pct = (outTimeUs / (durationSec * 1_000_000)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function estimateRemainingSec(
  outTimeUs: number | undefined,
  durationSec: number,
  speed: number | undefined,
): number | undefined {
  if (!speed || speed <= 0 || durationSec <= 0) return undefined;
  const encodedSec = (outTimeUs ?? 0) / 1_000_000;
  return Math.max(0, Math.round((durationSec - encodedSec) / speed));
}
