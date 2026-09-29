import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_CLEANUP, QUEUE_SUBTITLE, QUEUE_TRANSCODE } from "@myflix/shared";

@Injectable()
export class BullErrorLogger implements OnModuleInit {
  private readonly logger = new Logger("BullMQ");
  constructor(
    @InjectQueue(QUEUE_TRANSCODE) private readonly transcode: Queue,
    @InjectQueue(QUEUE_SUBTITLE) private readonly subtitle: Queue,
    @InjectQueue(QUEUE_CLEANUP) private readonly cleanup: Queue,
  ) {}
  onModuleInit(): void {
    // T14 / mission D10 — bullmq QueueBase.emit("error") console.error() stack trace thô khi Queue không có listener
    for (const queue of [this.transcode, this.subtitle, this.cleanup]) {
      queue.on("error", (err: Error) =>
        this.logger.error(`${queue.name}: ${err.message}`),
      );
    }
  }
}
