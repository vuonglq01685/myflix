import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS } from '../redis/redis.module';

/**
 * Refresh token rotation (HLD §2.2). Every refresh burns the old jti and
 * mints a new one. Presenting a burned jti means the token leaked, so every
 * session for that user is revoked rather than just the one.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private key(userId: string, jti: string) {
    return `refresh:${userId}:${jti}`;
  }

  async issue(userId: string): Promise<string> {
    const jti = randomUUID();
    const ttl = this.config.getOrThrow<number>('JWT_REFRESH_TTL');
    await this.redis.set(this.key(userId, jti), '1', 'EX', ttl);
    return jti;
  }

  /** True only if the jti was live; consuming it atomically prevents two
   *  concurrent refreshes from both succeeding. */
  async consume(userId: string, jti: string): Promise<boolean> {
    return (await this.redis.del(this.key(userId, jti))) === 1;
  }

  async revokeAll(userId: string): Promise<void> {
    const pattern = this.key(userId, '*');
    const stream = this.redis.scanStream({ match: pattern, count: 100 });
    for await (const keys of stream) {
      if ((keys as string[]).length) await this.redis.del(...(keys as string[]));
    }
  }
}
