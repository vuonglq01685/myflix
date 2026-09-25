import { Injectable, NotImplementedException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import {
  ErrorCode,
  JobStatus,
  QUEUE_TRANSCODE,
  type AdminStats,
  type JobListItem,
  type UserRole,
} from "@myflix/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { BusinessError } from "../../common/filters/all-exceptions.filter";

@Injectable()
export class AdminOpsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_TRANSCODE) private readonly transcodeQueue: Queue,
  ) {}

  listJobs(_status?: string): Promise<JobListItem[]> {
    throw new NotImplementedException("AdminOpsService.listJobs");
  }

  getJob(_id: string): Promise<JobListItem & { logText: string | null }> {
    throw new NotImplementedException("AdminOpsService.getJob");
  }

  async assertNotRunning(jobId: string): Promise<void> {
    const job = await this.prisma.transcodeJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (job?.status === JobStatus.RUNNING) {
      throw new BusinessError(
        ErrorCode.JOB_ALREADY_RUNNING,
        "Job đang chạy, không thể thử lại",
      );
    }
  }

  retryJob(_id: string): Promise<{ jobId: string }> {
    throw new NotImplementedException("AdminOpsService.retryJob");
  }

  cancelJob(_id: string): Promise<void> {
    throw new NotImplementedException("AdminOpsService.cancelJob");
  }

  stats(): Promise<AdminStats> {
    throw new NotImplementedException("AdminOpsService.stats");
  }

  storageUsage(): Promise<unknown> {
    throw new NotImplementedException("AdminOpsService.storageUsage");
  }

  purgeSources(): Promise<{ purged: number; freedBytes: number }> {
    throw new NotImplementedException("AdminOpsService.purgeSources");
  }

  listUsers(): Promise<unknown[]> {
    throw new NotImplementedException("AdminOpsService.listUsers");
  }

  updateUser(
    _id: string,
    _dto: { role?: UserRole; isActive?: boolean },
  ): Promise<unknown> {
    throw new NotImplementedException("AdminOpsService.updateUser");
  }
}
