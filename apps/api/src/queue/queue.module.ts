import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE_CLEANUP, QUEUE_SUBTITLE, QUEUE_TRANSCODE } from '@myflix/shared';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
        },
        defaultJobOptions: {
          // Two retries with escalating backoff (HLD §8.3). Permanent
          // failures (corrupt source, missing encoder) are re-thrown as
          // UnrecoverableError by the worker so they skip this entirely.
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: { age: 86_400, count: 500 },
          removeOnFail: false,
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_TRANSCODE },
      { name: QUEUE_SUBTITLE },
      { name: QUEUE_CLEANUP },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
