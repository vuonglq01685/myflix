import { Controller, Inject, MessageEvent, Sse, UseGuards } from '@nestjs/common';
import { Observable, Subject, interval, map, merge } from 'rxjs';
import type Redis from 'ioredis';
import { JOB_EVENTS_CHANNEL, SSE_HEARTBEAT_MS, UserRole } from '@myflix/shared';
import { Roles } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { REDIS_SUBSCRIBER } from '../redis/redis.module';

/**
 * Bridges the worker's Redis pub/sub into HTTP (HLD §5.3). nginx must keep
 * `proxy_buffering off` on /api/ or none of this reaches the browser.
 */
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class EventsController {
  private readonly jobEvents = new Subject<MessageEvent>();

  constructor(@Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis) {
    void this.subscriber.subscribe(JOB_EVENTS_CHANNEL);
    this.subscriber.on('message', (channel, payload) => {
      if (channel !== JOB_EVENTS_CHANNEL) return;
      try {
        const parsed = JSON.parse(payload) as { event: string; data: object };
        this.jobEvents.next({ type: parsed.event, data: parsed.data });
      } catch {
        // A malformed publish must not kill the stream for every admin.
      }
    });
  }

  @Sse('jobs')
  jobs(): Observable<MessageEvent> {
    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: {} })),
    );
    return merge(this.jobEvents.asObservable(), heartbeat);
  }
}
