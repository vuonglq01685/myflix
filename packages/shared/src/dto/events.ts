/** SSE payloads on GET /api/events/jobs (API spec §11). */
export interface JobProgressEvent {
  jobId: string;
  assetId: string;
  stage: string;
  percent: number;
  speed: string;
}

export interface JobCompletedEvent {
  jobId: string;
  assetId: string;
  status: "SUCCEEDED";
  durationMinutes: number;
}

export interface JobFailedEvent {
  jobId: string;
  assetId: string;
  errorMessage: string;
}

export type JobEvent =
  | { event: "job.progress"; data: JobProgressEvent }
  | { event: "job.completed"; data: JobCompletedEvent }
  | { event: "job.failed"; data: JobFailedEvent }
  | { event: "heartbeat"; data: Record<string, never> };

/** Proxies drop idle SSE connections; keep them warm. */
export const SSE_HEARTBEAT_MS = 30_000;
