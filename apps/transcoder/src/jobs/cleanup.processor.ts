import { OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { PinoLogger } from "nestjs-pino";
import { storage, Store } from "nestjs-pino/storage";
import type { Job } from "bullmq";
import { QUEUE_CLEANUP, resolveCorrelationId } from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

/**
 * Drains deletion_queue (doc 04 §6). Rows are written before the Postgres
 * records are dropped, so this is the only thing that still knows which
 * objects to remove.
 */
@Processor(QUEUE_CLEANUP, { concurrency: 1 })
export class CleanupProcessor extends WorkerHost {
  private static readonly BATCH = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly logger: PinoLogger,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ deleted: number }> {
    const correlationId = resolveCorrelationId(undefined);

    return storage.run(
      new Store(PinoLogger.root.child({ correlationId })),
      async () => {
        const pending = await this.prisma.deletionQueue.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          take: CleanupProcessor.BATCH,
        });

        let deleted = 0;
        for (const row of pending) {
          try {
            if (row.isPrefix) {
              await this.storage.deletePrefix(row.bucket, row.objectKey);
            } else {
              await this.storage.deleteObjects(row.bucket, [row.objectKey]);
            }
            await this.prisma.deletionQueue.update({
              where: { id: row.id },
              data: { deletedAt: new Date() },
            });
            deleted += 1;
          } catch (error) {
            // Leave the row pending; a later pass retries it.
            await this.prisma.deletionQueue.update({
              where: { id: row.id },
              data: {
                attempts: { increment: 1 },
                lastError:
                  error instanceof Error ? error.message : String(error),
              },
            });
            this.logger.warn(
              { err: error, key: row.objectKey },
              "object delete failed",
            );
          }
        }
        return { deleted };
      },
    );
  }

  @OnWorkerEvent("error")
  onWorkerError(err: Error): void {
    this.logger.error({ err }, "worker error"); // T14 / mission D10 — Worker không có listener "error" thì bullmq console.error() stack trace thô
  }
}
