import { Injectable, NotImplementedException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { QUEUE_SUBTITLE, type UploadSubtitleRequest } from "@myflix/shared";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class AdminSubtitlesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_SUBTITLE) private readonly subtitleQueue: Queue,
  ) {}

  upload(
    _assetId: string,
    _dto: UploadSubtitleRequest,
  ): Promise<{ jobId: string }> {
    throw new NotImplementedException("AdminSubtitlesService.upload");
  }

  list(assetId: string) {
    return this.prisma.subtitleTrack.findMany({
      where: { assetId },
      orderBy: [{ isDefault: "desc" }, { lang: "asc" }],
    });
  }

  extractEmbedded(_assetId: string): Promise<{ jobId: string }> {
    throw new NotImplementedException("AdminSubtitlesService.extractEmbedded");
  }

  update(
    _id: string,
    _dto: { label?: string; isDefault?: boolean },
  ): Promise<unknown> {
    // NOTE: uq_one_default_subtitle is a partial unique index, so promoting a
    // new default must clear the old one inside the same transaction.
    throw new NotImplementedException("AdminSubtitlesService.update");
  }

  remove(_id: string): Promise<void> {
    throw new NotImplementedException("AdminSubtitlesService.remove");
  }
}
