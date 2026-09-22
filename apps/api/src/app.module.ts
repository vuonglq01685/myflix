import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { AuthModule } from './auth/auth.module';
import { ProfilesModule } from './profiles/profiles.module';
import { CatalogModule } from './catalog/catalog.module';
import { PlaybackModule } from './playback/playback.module';
import { IngestModule } from './ingest/ingest.module';
import { AdminModule } from './admin/admin.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        // One correlation id per request, echoed in every error body (HLD §8.2).
        genReqId: (req) => (req.headers['x-correlation-id'] as string) ?? randomUUID(),
        customProps: (req) => ({ correlationId: req.id }),
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
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
