import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { COMPLETION_RATIO } from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";

/**
 * Write-behind watch progress (ADR-012). The player posts every 10s; that
 * lands in Redis. Postgres sees roughly one write per viewer per minute
 * instead of six, at a cost of up to 60s of lost position on a crash.
 */
@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);
  private static readonly TTL_SEC = 86_400;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  private key(profileId: string, assetId: string) {
    return `progress:${profileId}:${assetId}`;
  }

  async record(params: {
    profileId: string;
    assetId: string;
    positionSec: number;
    durationSec: number;
  }): Promise<{ completed: boolean }> {
    const completed =
      params.durationSec > 0 &&
      params.positionSec / params.durationSec >= COMPLETION_RATIO;

    await this.redis
      .multi()
      .hset(this.key(params.profileId, params.assetId), {
        positionSec: params.positionSec,
        completed: completed ? "1" : "0",
        updatedAt: Date.now(),
      })
      .expire(
        this.key(params.profileId, params.assetId),
        ProgressService.TTL_SEC,
      )
      .exec();

    // Finishing is a durable event — flush immediately so Continue Watching
    // drops the episode and picks up the next one without a 60s lag.
    if (completed) await this.flushOne(params.profileId, params.assetId);

    return { completed };
  }

  async flushOne(profileId: string, assetId: string): Promise<void> {
    const raw = await this.redis.hgetall(this.key(profileId, assetId));
    if (!raw.positionSec) return;

    const positionSec = Number(raw.positionSec);
    const completed = raw.completed === "1";

    await this.prisma.watchProgress.upsert({
      where: { profileId_assetId: { profileId, assetId } },
      update: { positionSec, completed },
      create: { profileId, assetId, positionSec, completed },
    });
  }

  /**
   * Periodic batch flush. Called from a scheduled task every 60s.
   *
   * ponytail: SCAN + per-key upsert. Fine at household scale (< 100 profiles);
   * batch into a single multi-row UPSERT if the key count ever grows.
   */
  async flushAll(): Promise<number> {
    let flushed = 0;
    const stream = this.redis.scanStream({ match: "progress:*", count: 200 });

    for await (const keys of stream) {
      for (const key of keys as string[]) {
        const [, profileId, assetId] = key.split(":");
        if (!profileId || !assetId) continue;
        try {
          await this.flushOne(profileId, assetId);
          flushed += 1;
        } catch (error) {
          this.logger.warn({ err: error, key }, "progress flush failed");
        }
      }
    }
    return flushed;
  }
}
