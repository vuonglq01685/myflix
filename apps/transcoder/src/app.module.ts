import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { LoggerModule } from "nestjs-pino";
import {
  LOG_REDACT_CONFIG,
  QUEUE_CLEANUP,
  QUEUE_SUBTITLE,
  QUEUE_TRANSCODE,
} from "@myflix/shared";

import { validateEnv } from "./config/env";
import { BullErrorLogger } from "./bull-error.logger";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis.module";
import { StorageModule } from "./storage/storage.module";
import { FfmpegService } from "./ffmpeg/ffmpeg.service";
import { KeyframeVerifier } from "./ffmpeg/keyframe-verifier";
import { JobEventsPublisher } from "./events/job-events.publisher";
import { TranscodeProcessor } from "./jobs/transcode.processor";
import { SubtitleProcessor } from "./jobs/subtitle.processor";
import { CleanupProcessor } from "./jobs/cleanup.processor";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({ pinoHttp: { redact: LOG_REDACT_CONFIG } }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>("REDIS_HOST"),
          port: config.getOrThrow<number>("REDIS_PORT"),
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_TRANSCODE },
      { name: QUEUE_SUBTITLE },
      { name: QUEUE_CLEANUP },
    ),
    PrismaModule,
    RedisModule,
    StorageModule,
    HealthModule,
  ],
  providers: [
    BullErrorLogger,
    FfmpegService,
    KeyframeVerifier,
    JobEventsPublisher,
    TranscodeProcessor,
    SubtitleProcessor,
    CleanupProcessor,
  ],
})
export class AppModule {}
