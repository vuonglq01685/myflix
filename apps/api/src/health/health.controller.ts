import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type Redis from 'ioredis';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_TRANSCODE } from '@myflix/shared';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

type CheckState = 'ok' | 'fail';

/** Docker healthcheck target. 503 when any dependency is down (API spec §12). */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(QUEUE_TRANSCODE) private readonly queue: Queue,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [postgres, redis] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
    ]);

    const counts = await this.queue
      .getJobCounts('waiting', 'active')
      .catch(() => ({ waiting: -1, active: -1 }));

    const checks = { postgres, redis };
    const healthy = Object.values(checks).every((c) => c === 'ok');
    if (!healthy) res.status(503);

    return {
      status: healthy ? 'ok' : 'degraded',
      checks,
      queue: { waiting: counts.waiting, active: counts.active },
      version: process.env.npm_package_version ?? '1.0.0',
    };
  }
}

async function probe(fn: () => Promise<unknown>): Promise<CheckState> {
  try {
    await fn();
    return 'ok';
  } catch {
    return 'fail';
  }
}
