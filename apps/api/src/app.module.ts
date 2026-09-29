import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";

import { validateEnv } from "./config/env";
import { PINO_HTTP_OPTIONS } from "./logger.options";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { QueueModule } from "./queue/queue.module";
import { StorageModule } from "./storage/storage.module";
import { AuthModule } from "./auth/auth.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { CatalogModule } from "./catalog/catalog.module";
import { PlaybackModule } from "./playback/playback.module";
import { IngestModule } from "./ingest/ingest.module";
import { AdminModule } from "./admin/admin.module";
import { EventsModule } from "./events/events.module";
import { HealthModule } from "./health/health.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({ pinoHttp: PINO_HTTP_OPTIONS }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    PrismaModule,
    RedisModule,
    QueueModule,
    StorageModule,

    AuthModule,
    ProfilesModule,
    CatalogModule,
    PlaybackModule,
    IngestModule,
    AdminModule,
    EventsModule,
    HealthModule,
    MaintenanceModule,
  ],
  providers: [
    AllExceptionsFilter,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
