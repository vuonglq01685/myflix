import {
  AUDIO_BITRATE_KBPS,
  KEYFRAME_ARGS,
  buildLadder,
  gopForFrameRate,
  scaleFilter,
  type Rung,
} from "@myflix/shared";

export interface ProbeResult {
  width: number;
  height: number;
  frameRate: number;
  durationSec: number;
  videoCodec: string;
  audioCodec: string | null;
}

export interface LadderJobOptions {
  sourcePath: string;
  outputDir: string;
  probe: ProbeResult;
  encoder?: string;
  preset?: string;
  segmentSeconds?: number;
}

/**
 * One FFmpeg invocation: decode once on the GPU, split the decoded frames in
 * VRAM, scale and encode each rung in parallel (spec 09 §4.2).
 *
 * Running four separate commands instead would decode the source four times
 * and copy every frame back to system RAM — the single biggest performance
 * mistake available in this pipeline.
 */
export function buildLadderArgs(options: LadderJobOptions): string[] {
  const { sourcePath, outputDir, probe } = options;
  const encoder = options.encoder ?? "h264_nvenc";
  const preset = options.preset ?? "p5";
  const segmentSeconds = options.segmentSeconds ?? 4;

  const rungs = buildLadder(probe);
  const portrait = probe.height > probe.width;
  const gop = gopForFrameRate(probe.frameRate, segmentSeconds);
  const labels = rungs.map((_, i) => `v${i}`);

  const filter = [
    `[0:v]split=${rungs.length}${labels.map((l) => `[s${l}]`).join("")}`,
    ...rungs.map(
      (rung, i) =>
        `[s${labels[i]}]${scaleFilter(rung, portrait)}[${labels[i]}]`,
    ),
  ].join(";");

  const args = [
    "-y",
    "-hide_banner",
    "-hwaccel",
    "cuda",
    // Keeps decoded frames in VRAM. Omitting this silently copies every frame
    // back to system memory and throws away the whole speed advantage.
    "-hwaccel_output_format",
    "cuda",
    "-i",
    sourcePath,
    "-filter_complex",
    filter,
  ];

  rungs.forEach((rung, i) => {
    args.push(
      "-map",
      `[${labels[i]}]`,
      `-c:v:${i}`,
      encoder,
      `-profile:v:${i}`,
      rung.profile,
      "-preset",
      preset,
      "-rc",
      "vbr",
      `-cq:v:${i}`,
      String(rung.cq),
      `-b:v:${i}`,
      `${rung.bitrateKbps}k`,
      `-maxrate:v:${i}`,
      `${rung.maxrateKbps}k`,
      `-bufsize:v:${i}`,
      `${rung.bufsizeKbps}k`,
    );
  });

  // var_stream_map wants one audio stream per variant, so the single source
  // track is mapped once per rung.
  rungs.forEach(() => args.push("-map", "a:0?"));
  args.push(
    "-c:a",
    "aac",
    "-b:a",
    `${AUDIO_BITRATE_KBPS}k`,
    "-ac",
    "2",
    "-ar",
    "48000",
  );

  args.push(...KEYFRAME_ARGS(gop));

  args.push(
    "-f",
    "hls",
    "-hls_time",
    String(segmentSeconds),
    "-hls_playlist_type",
    "vod",
    "-hls_segment_type",
    "fmp4",
    "-hls_fmp4_init_filename",
    "init.mp4",
    "-hls_segment_filename",
    `${outputDir}/v/%v/seg-%05d.m4s`,
    "-master_pl_name",
    "master.m3u8",
    "-var_stream_map",
    variantStreamMap(rungs),
    "-progress",
    "pipe:1",
    "-nostats",
    `${outputDir}/v/%v/playlist.m3u8`,
  );

  return args;
}

export function variantStreamMap(rungs: Rung[]): string {
  return rungs.map((rung, i) => `v:${i},a:${i},name:${rung.name}`).join(" ");
}

/**
 * Hover-card preview (ADR-007): a standalone progressive MP4, not HLS.
 * Starting at 20% of the runtime skips studio logos and opening credits.
 */
export function buildPreviewArgs(params: {
  sourcePath: string;
  outputPath: string;
  durationSec: number;
  encoder?: string;
}): string[] {
  const startSec = Math.max(0, Math.floor(params.durationSec * 0.2));
  return [
    "-y",
    "-hide_banner",
    "-hwaccel",
    "cuda",
    "-hwaccel_output_format",
    "cuda",
    // -ss BEFORE -i seeks by keyframe instead of decoding from zero.
    "-ss",
    String(startSec),
    "-i",
    params.sourcePath,
    "-t",
    "25",
    "-vf",
    "scale_cuda=854:480",
    "-c:v",
    params.encoder ?? "h264_nvenc",
    "-preset",
    "p4",
    "-b:v",
    "400k",
    "-maxrate",
    "500k",
    "-bufsize",
    "800k",
    "-an",
    // Moves the moov atom to the front so playback starts after a few tens of
    // KB. Without it the card waits for the whole file and the effect is lost.
    "-movflags",
    "+faststart",
    params.outputPath,
  ];
}

/** One thumbnail every 10s, tiled into a near-square grid (spec 09 §7). */
export function spriteGrid(
  durationSec: number,
  intervalSec = 10,
): { cols: number; rows: number; count: number } {
  const count = Math.max(1, Math.ceil(durationSec / intervalSec));
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows, count };
}

export function buildSpriteArgs(params: {
  sourcePath: string;
  outputPattern: string;
  durationSec: number;
  intervalSec?: number;
}): string[] {
  const interval = params.intervalSec ?? 10;
  const { cols, rows } = spriteGrid(params.durationSec, interval);
  return [
    "-y",
    "-hide_banner",
    "-i",
    params.sourcePath,
    "-vf",
    `fps=1/${interval},scale=160:90,tile=${cols}x${rows}`,
    "-q:v",
    "5",
    params.outputPattern,
  ];
}

export const SPRITE_THUMB_WIDTH = 160;
export const SPRITE_THUMB_HEIGHT = 90;

/** WebVTT that maps a playhead position to a tile in the sprite sheet. */
export function buildSpriteVtt(params: {
  durationSec: number;
  intervalSec?: number;
  spriteFileName: (index: number) => string;
  /** Tiles per sheet before rolling over to the next file. */
  tilesPerSheet?: number;
}): string {
  const interval = params.intervalSec ?? 10;
  const { cols, count } = spriteGrid(params.durationSec, interval);
  const perSheet = params.tilesPerSheet ?? count;

  const lines = ["WEBVTT", ""];
  for (let i = 0; i < count; i++) {
    const sheet = Math.floor(i / perSheet);
    const local = i % perSheet;
    const x = (local % cols) * SPRITE_THUMB_WIDTH;
    const y = Math.floor(local / cols) * SPRITE_THUMB_HEIGHT;
    lines.push(
      `${timestamp(i * interval)} --> ${timestamp(Math.min((i + 1) * interval, params.durationSec))}`,
      `${params.spriteFileName(sheet)}#xywh=${x},${y},${SPRITE_THUMB_WIDTH},${SPRITE_THUMB_HEIGHT}`,
      "",
    );
  }
  return lines.join("\n");
}

function timestamp(totalSeconds: number): string {
  const ms = Math.round((totalSeconds % 1) * 1000);
  const s = Math.floor(totalSeconds) % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}
