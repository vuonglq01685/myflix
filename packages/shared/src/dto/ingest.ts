import type { AssetKind } from "../enums";

export interface IngestInitRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
  kind: AssetKind;
  titleId?: string;
  episodeId?: string;
}

export interface PartUrl {
  partNumber: number;
  url: string;
}

export interface IngestInitResponse {
  assetId: string;
  uploadId: string;
  partSizeBytes: number;
  totalParts: number;
  /** Issued in batches of 50; fetch the rest via /ingest/{id}/part-urls. */
  partUrls: PartUrl[];
}

export interface CompletedPart {
  partNumber: number;
  eTag: string;
}

export interface IngestCompleteRequest {
  assetId: string;
  uploadId: string;
  parts: CompletedPart[];
}

export interface IngestCompleteResponse {
  assetId: string;
  jobId: string;
  status: "QUEUED";
  queuePosition: number;
}

export const PART_URL_BATCH_SIZE = 50;
export const UPLOAD_PARALLELISM = 4;

/**
 * Payload of a BullMQ job on QUEUE_TRANSCODE. Defined once so api (producer)
 * and transcoder (consumer) cannot drift. `correlationId` is the request id
 * of the POST /ingest/complete that enqueued it — the worker logs it on every
 * line so one id traces web -> api -> transcoder (NFR-46, DoD-6-2).
 */
export interface TranscodeJobData {
  assetId: string;
  jobId: string;
  sourceKey: string;
  correlationId: string;
}
