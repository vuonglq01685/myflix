import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * AC-010-3. Every rendition must place its keyframes at identical timestamps;
 * if they drift, an ABR switch stutters. This runs after packaging and fails
 * the job rather than shipping an asset that glitches on every quality change.
 */
@Injectable()
export class KeyframeVerifier {
  constructor(private readonly config: ConfigService) {}

  async keyframeTimes(playlistPath: string): Promise<number[]> {
    const { stdout } = await execFileAsync(this.config.getOrThrow<string>('FFPROBE_BIN'), [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'frame=pts_time,key_frame',
      '-of', 'csv=p=0',
      playlistPath,
    ], { maxBuffer: 64 * 1024 * 1024 });

    return stdout
      .split('\n')
      .map((line) => line.split(','))
      .filter((cols) => cols[1]?.trim() === '1')
      .map((cols) => Number(cols[0]))
      .filter(Number.isFinite);
  }

  /** Compares each rendition against the first and reports the first drift. */
  async verify(playlistPaths: string[]): Promise<{ aligned: boolean; reason?: string }> {
    if (playlistPaths.length < 2) return { aligned: true };

    const [reference, ...rest] = await Promise.all(playlistPaths.map((p) => this.keyframeTimes(p)));
    for (const [index, times] of rest.entries()) {
      if (times.length !== reference!.length) {
        return {
          aligned: false,
          reason: `rendition ${index + 1} has ${times.length} keyframes, expected ${reference!.length}`,
        };
      }
      // Encoder timestamps carry float noise; 1ms is far below a frame.
      const drift = times.findIndex((t, i) => Math.abs(t - reference![i]!) > 0.001);
      if (drift !== -1) {
        return {
          aligned: false,
          reason: `rendition ${index + 1} keyframe ${drift} at ${times[drift]}s, expected ${reference![drift]}s`,
        };
      }
    }
    return { aligned: true };
  }
}
