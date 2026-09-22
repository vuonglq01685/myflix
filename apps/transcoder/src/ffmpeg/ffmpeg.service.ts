import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseFrameRate, parseProgressChunk, type FfmpegProgress } from '@myflix/shared';
import type { ProbeResult } from './args';

const execFileAsync = promisify(execFile);

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly log: string,
    /** Configuration and corrupt-input failures must not be retried. */
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

@Injectable()
export class FfmpegService {
  private readonly logger = new Logger(FfmpegService.name);
  /** Keep only the tail — transcode_jobs.log_text stores 200 lines (HLD §9). */
  private static readonly LOG_TAIL_LINES = 200;

  constructor(private readonly config: ConfigService) {}

  async probe(inputPath: string): Promise<ProbeResult> {
    const { stdout } = await execFileAsync(this.config.getOrThrow<string>('FFPROBE_BIN'), [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate',
      '-show_entries', 'format=duration',
      '-of', 'json',
      inputPath,
    ]);

    const parsed = JSON.parse(stdout) as {
      streams?: Array<Record<string, string | number>>;
      format?: { duration?: string };
    };
    const video = parsed.streams?.find((s) => s.codec_type === 'video');
    const audio = parsed.streams?.find((s) => s.codec_type === 'audio');
    if (!video) throw new FfmpegError('source has no video stream', stdout, true);

    return {
      width: Number(video.width),
      height: Number(video.height),
      frameRate: parseFrameRate(String(video.r_frame_rate)),
      durationSec: Math.round(Number(parsed.format?.duration ?? 0)),
      videoCodec: String(video.codec_name),
      audioCodec: audio ? String(audio.codec_name) : null,
    };
  }

  /**
   * Runs FFmpeg, streaming `-progress` output to `onProgress`. stderr is kept
   * only as a bounded tail so a chatty encode cannot exhaust memory.
   */
  run(args: string[], onProgress?: (p: FfmpegProgress) => void): Promise<string> {
    const bin = this.config.getOrThrow<string>('FFMPEG_BIN');
    const timeoutMs = this.config.getOrThrow<number>('TRANSCODE_TIMEOUT_SEC') * 1000;

    return new Promise<string>((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const logLines: string[] = [];
      let stdoutBuffer = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new FfmpegError(`ffmpeg exceeded ${timeoutMs / 1000}s`, tail(logLines), true));
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBuffer += chunk.toString();
        // -progress emits blocks terminated by a progress= line.
        let idx: number;
        while ((idx = stdoutBuffer.indexOf('progress=')) !== -1) {
          const end = stdoutBuffer.indexOf('\n', idx);
          if (end === -1) break;
          const block = stdoutBuffer.slice(0, end + 1);
          stdoutBuffer = stdoutBuffer.slice(end + 1);
          const progress = parseProgressChunk(block);
          if (progress && onProgress) onProgress(progress);
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.trim()) continue;
          logLines.push(line);
          if (logLines.length > FfmpegService.LOG_TAIL_LINES) logLines.shift();
        }
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new FfmpegError(error.message, tail(logLines), true));
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        const log = tail(logLines);
        if (code === 0) return resolve(log);
        reject(new FfmpegError(`ffmpeg exited with ${code}`, log, isPermanent(log)));
      });
    });
  }
}

const tail = (lines: string[]) => lines.join('\n');

/**
 * HLD §8.3 — only transient failures deserve a retry. A missing encoder is a
 * broken image and a corrupt source will never decode, so retrying either
 * just burns the queue.
 */
export function isPermanent(log: string): boolean {
  return [
    'Unknown encoder',
    'Invalid data found when processing input',
    'No space left on device',
    'moov atom not found',
  ].some((needle) => log.includes(needle));
}
