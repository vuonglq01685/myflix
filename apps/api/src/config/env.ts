import { z } from "zod";

/**
 * Fail fast at boot if a secret is missing. A half-configured API that starts
 * and then 500s on the first playback request is strictly worse than one that
 * refuses to listen.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost"),

  DATABASE_URL: z.string().min(1),
  REDIS_HOST: z.string().default("redis"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  BUCKET_SOURCE: z.string().default("myflix-source"),
  BUCKET_MEDIA: z.string().default("myflix-media"),
  BUCKET_IMAGES: z.string().default("myflix-images"),
  BUCKET_STAGING: z.string().default("myflix-staging"),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
  ALLOW_REGISTRATION: z.coerce.boolean().default(true),

  // Must equal MEDIA_SIGNING_SECRET rendered into the nginx config, or every
  // signed URL comes back 403.
  MEDIA_SIGNING_SECRET: z.string().min(16),
  MEDIA_URL_TTL_SEC: z.coerce.number().int().positive().default(14_400),

  UPLOAD_PART_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(16_777_216),
  UPLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(3_600),
});

export type Env = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`invalid environment:\n${issues}`);
  }
  return parsed.data;
}
