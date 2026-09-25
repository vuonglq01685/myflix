import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { QUEUE_CLEANUP } from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

/**
 * Drains deletion_queue (doc 04 §6). Rows are written before the Postgres
 * records are dropped, so this is the only thing that still knows which
 * objects to remove.
 */
@Processor(QUEUE_CLEANUP, { concurrency: 1 })
export class CleanupProcessor extends WorkerHost {
  private readonly logger = new Logger(CleanupProcessor.name);
  private static readonly BATCH = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(_job: Job): Promise<{ deleted: number }> {
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
            lastError: error instanceof Error ? error.message : String(error),
          },
        });
        this.logger.warn(
          { err: error, key: row.objectKey },
          "object delete failed",
        );
      }
    }
    return { deleted };
  }
}
