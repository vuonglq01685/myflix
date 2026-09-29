import { Processor, WorkerHost } from "@nestjs/bullmq";
import { ConfigService } from "@nestjs/config";
import { PinoLogger } from "nestjs-pino";
import { storage, Store } from "nestjs-pino/storage";
import { UnrecoverableError, type Job } from "bullmq";
import {
  AssetStatus,
  JobStatus,
  QUEUE_TRANSCODE,
  computePercent,
  resolveCorrelationId,
  type TranscodeJobData,
} from "@myflix/shared";
import { keys } from "@myflix/storage";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { FfmpegService, FfmpegError } from "../ffmpeg/ffmpeg.service";
import { KeyframeVerifier } from "../ffmpeg/keyframe-verifier";
import { JobEventsPublisher } from "../events/job-events.publisher";

/**
 * The asset state machine (HLD §5.2):
 *   QUEUED -> PROBING -> ENCODING -> PACKAGING -> COMMITTING -> READY
 * with FAILED reachable from any step.
 *
 * Everything is written to myflix-staging/{jobId}/ and only copied into
 * myflix-media/{assetId}/ once every step succeeded, so the serving bucket
 * can never hold a half-finished asset (AC-010-5).
 *
 * Concurrency is 1 — see ADR-005.
 */
@Processor(QUEUE_TRANSCODE, {
  concurrency: Number(process.env.TRANSCODE_CONCURRENCY ?? 1),
})
export class TranscodeProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ffmpeg: FfmpegService,
    private readonly keyframes: KeyframeVerifier,
    private readonly events: JobEventsPublisher,
    private readonly config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(job: Job<TranscodeJobData>): Promise<void> {
    const { assetId, jobId } = job.data;
    const correlationId = resolveCorrelationId(job.data.correlationId);
    const startedAt = Date.now();

    return storage.run(
      new Store(PinoLogger.root.child({ correlationId })),
      async () => {
        this.logger.info({ jobId, assetId }, "job started");

        try {
          await this.mark(
            jobId,
            assetId,
            JobStatus.RUNNING,
            AssetStatus.PROBING,
          );

          // TODO(phase-1) in order:
          //  1. download the source from myflix-source into SCRATCH_DIR
          //  2. ffmpeg.probe -> persist duration, dimensions, frame rate, codecs
          //  3. ENCODING: run buildLadderArgs, forwarding progress via
          //     computePercent + events.progress
          //  4. keyframes.verify across every rendition playlist; fail the job if
          //     they drift (AC-010-3)
          //  5. PACKAGING: sprite sheet, sprite VTT, preview clip
          //  6. COMMITTING: storage.commitPrefix staging -> media, then write the
          //     renditions rows
          //  7. READY: set hls_master_key (the ck_ready_needs_master CHECK
          //     rejects the update otherwise) and ready_at
          void keys;
          void computePercent;
          throw new Error("TranscodeProcessor.process not implemented");
        } catch (error) {
          await this.fail(jobId, assetId, error);
          // A permanent failure must not consume the two configured retries.
          if (error instanceof FfmpegError && error.permanent) {
            throw new UnrecoverableError(error.message);
          }
          throw error;
        } finally {
          // Staging debris is removed whether the job succeeded or not (R-5).
          await this.storage
            .deletePrefix(this.storage.buckets.staging, `${jobId}/`)
            .catch((error: unknown) =>
              this.logger.warn({ err: error, jobId }, "staging cleanup failed"),
            );

          this.logger.info(
            { jobId, assetId, elapsedMs: Date.now() - startedAt },
            "job finished",
          );
        }
      },
    );
  }

  private async mark(
    jobId: string,
    assetId: string,
    status: JobStatus,
    assetStatus: AssetStatus,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.transcodeJob.update({
        where: { id: jobId },
        data: { status, stage: assetStatus, startedAt: new Date() },
      }),
      this.prisma.mediaAsset.update({
        where: { id: assetId },
        data: { status: assetStatus },
      }),
    ]);
  }

  private async fail(
    jobId: string,
    assetId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const log = error instanceof FfmpegError ? error.log : null;

    await this.prisma.$transaction([
      this.prisma.transcodeJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          errorMessage: message,
          logText: log,
          finishedAt: new Date(),
        },
      }),
      this.prisma.mediaAsset.update({
        where: { id: assetId },
        data: { status: AssetStatus.FAILED, errorMessage: message },
      }),
    ]);

    await this.events.failed({ jobId, assetId, errorMessage: message });
  }
}
