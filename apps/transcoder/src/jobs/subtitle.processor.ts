import { Processor, WorkerHost } from "@nestjs/bullmq";
import { PinoLogger } from "nestjs-pino";
import { storage, Store } from "nestjs-pino/storage";
import type { Job } from "bullmq";
import { QUEUE_SUBTITLE, resolveCorrelationId } from "@myflix/shared";

export interface SubtitleJobData {
  assetId: string;
  subtitleTrackId: string;
  sourceKey: string;
  lang: string;
  correlationId?: string;
}

/**
 * Subtitles run on their own queue with higher concurrency: they hold no
 * NVENC session, so making them wait behind a two-hour encode would be silly.
 *
 * Pipeline (spec 09 §6): detect encoding -> UTF-8 -> WebVTT -> 4s segments
 * aligned to the video timeline -> s/{lang}/playlist.m3u8 -> EXT-X-MEDIA line
 * in master.m3u8.
 */
@Processor(QUEUE_SUBTITLE, { concurrency: 2 })
export class SubtitleProcessor extends WorkerHost {
  constructor(private readonly logger: PinoLogger) {
    super();
  }

  async process(job: Job<SubtitleJobData>): Promise<void> {
    const correlationId = resolveCorrelationId(job.data.correlationId);

    return storage.run(
      new Store(PinoLogger.root.child({ correlationId })),
      async () => {
        this.logger.info({ assetId: job.data.assetId }, "job started");
        // TODO(phase-5): Vietnamese subtitles are usually Windows-1258 or
        // UTF-16LE, so encoding detection comes first: BOM, then strict UTF-8,
        // then chardet at 0.7 confidence, then the windows-1252/1258 correction.
        // Refuse rather than guess, and warn when a `vi` track ends up with zero
        // characters in U+1EA0-U+1EF9.
        throw new Error("SubtitleProcessor.process not implemented");
      },
    );
  }
}
