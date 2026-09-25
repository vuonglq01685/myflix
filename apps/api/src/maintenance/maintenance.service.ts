import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_CLEANUP } from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ProgressService } from "../playback/progress.service";

export const PROGRESS_FLUSH_MS = 60_000;
export const PARTITION_CHECK_MS = 6 * 60 * 60_000;
export const CLEANUP_DRAIN_MS = 5 * 60_000;

/** Name and bounds of the monthly playback_events partition holding `date`. */
export function partitionFor(date: Date): {
  name: string;
  from: string;
  to: string;
} {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const iso = (year: number, month: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const next = m === 11 ? [y + 1, 0] : [y, m + 1];
  return {
    name: `playback_events_${y}_${String(m + 1).padStart(2, "0")}`,
    from: iso(y, m),
    to: iso(next[0]!, next[1]!),
  };
}

/**
 * The three background clocks the docs assume but no request triggers:
 *  - ADR-012: flush Redis watch progress to Postgres every 60s
 *  - doc 04 §3.13: the next month's playback_events partition must exist
 *    before the month starts
 *  - doc 04 §6: something has to drain deletion_queue — the transcoder's
 *    CleanupProcessor consumes, this is the repeatable producer
 *
 * ponytail: plain setInterval instead of @nestjs/schedule. One instance of
 * the api runs today; if it ever scales out, move these to BullMQ repeatable
 * jobs so they fire once, not once per replica.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: ProgressService,
    @InjectQueue(QUEUE_CLEANUP) private readonly cleanup: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensurePartitions();
    await this.cleanup.add(
      "drain",
      {},
      { repeat: { every: CLEANUP_DRAIN_MS }, jobId: "deletion-queue-drain" },
    );

    this.timers = [
      setInterval(
        () =>
          void this.safely("progress flush", () => this.progress.flushAll()),
        PROGRESS_FLUSH_MS,
      ),
      setInterval(
        () =>
          void this.safely("partition check", () => this.ensurePartitions()),
        PARTITION_CHECK_MS,
      ),
    ];
    for (const t of this.timers) t.unref();
  }

  async onModuleDestroy(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    // Last chance to land buffered positions before the process goes away.
    await this.safely("final progress flush", () => this.progress.flushAll());
  }

  /** Current and next month. Idempotent: IF NOT EXISTS. */
  async ensurePartitions(now = new Date()): Promise<void> {
    const nextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    for (const p of [partitionFor(now), partitionFor(nextMonth)]) {
      // Identifiers are built from integers only, so interpolation is safe.
      await this.prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS ${p.name} PARTITION OF playback_events
           FOR VALUES FROM ('${p.from}') TO ('${p.to}')`,
      );
    }
  }

  private async safely(
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.logger.warn({ err: error }, `${label} failed`);
    }
  }
}
