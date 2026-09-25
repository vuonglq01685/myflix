import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { JOB_EVENTS_CHANNEL } from "@myflix/shared";
import { REDIS } from "../redis.module";

/** Worker -> Redis -> api SSE -> admin browser (HLD §5.3). */
@Injectable()
export class JobEventsPublisher {
  /** Last published percent per job, so we only speak when it changed by at
   *  least a point. Publishing every 0.5s progress tick floods pub/sub. */
  private readonly lastPercent = new Map<string, number>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async progress(payload: {
    jobId: string;
    assetId: string;
    stage: string;
    percent: number;
    speed: string;
  }): Promise<void> {
    const previous = this.lastPercent.get(payload.jobId);
    if (previous !== undefined && Math.abs(payload.percent - previous) < 1)
      return;
    this.lastPercent.set(payload.jobId, payload.percent);
    await this.publish("job.progress", payload);
  }

  async completed(payload: {
    jobId: string;
    assetId: string;
    durationMinutes: number;
  }): Promise<void> {
    this.lastPercent.delete(payload.jobId);
    await this.publish("job.completed", { ...payload, status: "SUCCEEDED" });
  }

  async failed(payload: {
    jobId: string;
    assetId: string;
    errorMessage: string;
  }): Promise<void> {
    this.lastPercent.delete(payload.jobId);
    await this.publish("job.failed", payload);
  }

  private publish(event: string, data: unknown): Promise<number> {
    return this.redis.publish(
      JOB_EVENTS_CHANNEL,
      JSON.stringify({ event, data }),
    );
  }
}
