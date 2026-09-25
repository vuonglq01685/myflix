import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { QUEUE_SUBTITLE } from "@myflix/shared";

export interface SubtitleJobData {
  assetId: string;
  subtitleTrackId: string;
  sourceKey: string;
  lang: string;
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
  private readonly logger = new Logger(SubtitleProcessor.name);

  async process(job: Job<SubtitleJobData>): Promise<void> {
    void job;
    // TODO(phase-5): Vietnamese subtitles are usually Windows-1258 or
    // UTF-16LE, so encoding detection comes first: BOM, then strict UTF-8,
    // then chardet at 0.7 confidence, then the windows-1252/1258 correction.
    // Refuse rather than guess, and warn when a `vi` track ends up with zero
    // characters in U+1EA0-U+1EF9.
    throw new Error("SubtitleProcessor.process not implemented");
  }
}
