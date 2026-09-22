import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().default('redis'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  BUCKET_SOURCE: z.string().default('myflix-source'),
  BUCKET_MEDIA: z.string().default('myflix-media'),
  BUCKET_IMAGES: z.string().default('myflix-images'),
  BUCKET_STAGING: z.string().default('myflix-staging'),

  // ADR-005: the RTX 4070 SUPER allows 8 concurrent NVENC sessions and a
  // 4-rung ladder burns 4. Two jobs would sit exactly on the ceiling with no
  // headroom for anything else on the machine, so this stays at 1.
  TRANSCODE_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  TRANSCODE_ENCODER: z.string().default('h264_nvenc'),
  TRANSCODE_PRESET: z.string().default('p5'),
  TRANSCODE_SEGMENT_SEC: z.coerce.number().int().positive().default(4),
  TRANSCODE_TIMEOUT_SEC: z.coerce.number().int().positive().default(14_400),
  FFMPEG_BIN: z.string().default('/usr/local/bin/ffmpeg'),
  FFPROBE_BIN: z.string().default('/usr/local/bin/ffprobe'),
  SCRATCH_DIR: z.string().default('/scratch'),
});

export type WorkerEnv = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): WorkerEnv {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid environment:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
}
