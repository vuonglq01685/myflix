/**
 * Mirrors the Postgres enums. Duplicated here rather than re-exported from
 * the Prisma client so that the browser bundle never pulls in Prisma.
 */
export const UserRole = { VIEWER: 'VIEWER', ADMIN: 'ADMIN' } as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const TitleType = { MOVIE: 'MOVIE', SERIES: 'SERIES' } as const;
export type TitleType = (typeof TitleType)[keyof typeof TitleType];

export const TitleStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type TitleStatus = (typeof TitleStatus)[keyof typeof TitleStatus];

export const AssetKind = {
  MOVIE: 'MOVIE',
  EPISODE: 'EPISODE',
  TRAILER: 'TRAILER',
} as const;
export type AssetKind = (typeof AssetKind)[keyof typeof AssetKind];

/** HLD §5.2. READY is the only state that permits playback (DI-10). */
export const AssetStatus = {
  UPLOADING: 'UPLOADING',
  QUEUED: 'QUEUED',
  PROBING: 'PROBING',
  ENCODING: 'ENCODING',
  PACKAGING: 'PACKAGING',
  COMMITTING: 'COMMITTING',
  READY: 'READY',
  FAILED: 'FAILED',
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const SubtitleKind = {
  SUBTITLES: 'SUBTITLES',
  CAPTIONS: 'CAPTIONS',
  FORCED: 'FORCED',
} as const;
export type SubtitleKind = (typeof SubtitleKind)[keyof typeof SubtitleKind];

export const JobStatus = {
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const QUEUE_TRANSCODE = 'transcode';
export const QUEUE_SUBTITLE = 'subtitle';
export const QUEUE_CLEANUP = 'cleanup';

/** Redis pub/sub channel the worker publishes progress on (HLD §5.3). */
export const jobChannel = (jobId: string) => `job:${jobId}`;
export const JOB_EVENTS_CHANNEL = 'job:events';
