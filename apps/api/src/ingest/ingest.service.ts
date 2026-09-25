import { Injectable, NotImplementedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  QUEUE_TRANSCODE,
  type IngestCompleteRequest,
  type IngestCompleteResponse,
  type IngestInitRequest,
  type IngestInitResponse,
  type PartUrl,
} from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_TRANSCODE) private readonly transcodeQueue: Queue,
  ) {}

  /** Parts are 16 MB, so an 8 GB source is ~500 parts — well under the
   *  10,000-part S3 ceiling. */
  partCount(fileSize: number): number {
    const partSize = this.config.getOrThrow<number>("UPLOAD_PART_SIZE_BYTES");
    return Math.max(1, Math.ceil(fileSize / partSize));
  }

  // TODO(phase-1): create the asset row at UPLOADING, open the multipart
  // upload, and hand back the first batch of 50 presigned part URLs.
  init(_dto: IngestInitRequest): Promise<IngestInitResponse> {
    throw new NotImplementedException("IngestService.init");
  }

  partUrls(_assetId: string, _from: number, _to: number): Promise<PartUrl[]> {
    throw new NotImplementedException("IngestService.partUrls");
  }

  /** Server-side view of which parts landed, for resuming a broken upload. */
  listReceivedParts(_assetId: string): Promise<number[]> {
    throw new NotImplementedException("IngestService.listReceivedParts");
  }

  // TODO(phase-1): complete the multipart upload, move the asset to QUEUED,
  // create the transcode_jobs row, then enqueue. Enqueue last so a queued job
  // can never reference a row that does not exist yet. The job payload is
  // TranscodeJobData from @myflix/shared; pass the request's correlationId
  // (req.id from pino-http) so the worker's log lines carry it (NFR-46).
  complete(
    _dto: IngestCompleteRequest,
    _correlationId: string,
  ): Promise<IngestCompleteResponse> {
    throw new NotImplementedException("IngestService.complete");
  }

  abort(_assetId: string): Promise<void> {
    throw new NotImplementedException("IngestService.abort");
  }
}
