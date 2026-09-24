import { Injectable, NotImplementedException } from "@nestjs/common";
import {
  AssetStatus,
  ErrorCode,
  parseEpisodeFilename,
  TitleStatus,
  type AdminTitleListItem,
  type CreateTitleRequest,
  type Page,
} from "@myflix/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogService } from "../../catalog/catalog.service";
import { BusinessError } from "../../common/filters/all-exceptions.filter";

@Injectable()
export class AdminContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
  ) {}

  listTitles(_filter: {
    status?: string;
    cursor?: string;
  }): Promise<Page<AdminTitleListItem>> {
    throw new NotImplementedException("AdminContentService.listTitles");
  }

  createTitle(_dto: CreateTitleRequest): Promise<{ id: string }> {
    throw new NotImplementedException("AdminContentService.createTitle");
  }

  getTitle(_id: string): Promise<unknown> {
    throw new NotImplementedException("AdminContentService.getTitle");
  }

  updateTitle(
    _id: string,
    _dto: Partial<CreateTitleRequest>,
  ): Promise<unknown> {
    throw new NotImplementedException("AdminContentService.updateTitle");
  }

  /** DI-07 — publishing a title with nothing playable would put a dead card
   *  on the Browse page. */
  async publish(id: string): Promise<{ id: string; status: TitleStatus }> {
    const readyAssets = await this.prisma.mediaAsset.count({
      where: {
        status: AssetStatus.READY,
        OR: [{ titleId: id }, { episode: { season: { titleId: id } } }],
      },
    });
    if (readyAssets === 0) {
      throw new BusinessError(
        ErrorCode.TITLE_NOT_PUBLISHABLE,
        "Chưa có nội dung nào xử lý xong để phát",
      );
    }

    const title = await this.prisma.title.update({
      where: { id },
      data: { status: TitleStatus.PUBLISHED, publishedAt: new Date() },
    });
    await this.catalog.invalidate(id);
    return { id: title.id, status: title.status };
  }

  async unpublish(id: string): Promise<{ id: string; status: TitleStatus }> {
    const title = await this.prisma.title.update({
      where: { id },
      data: { status: TitleStatus.DRAFT },
    });
    await this.catalog.invalidate(id);
    return { id: title.id, status: title.status };
  }

  // TODO(phase-3): archive, collect every object key into deletion_queue,
  // delete the rows in one transaction, let the cleanup job empty MinIO.
  removeTitle(_id: string): Promise<void> {
    throw new NotImplementedException("AdminContentService.removeTitle");
  }

  createSeason(
    _titleId: string,
    _dto: { number: number; name?: string },
  ): Promise<unknown> {
    throw new NotImplementedException("AdminContentService.createSeason");
  }

  updateSeason(
    _id: string,
    _dto: { name?: string; synopsis?: string },
  ): Promise<unknown> {
    throw new NotImplementedException("AdminContentService.updateSeason");
  }

  removeSeason(_id: string): Promise<void> {
    throw new NotImplementedException("AdminContentService.removeSeason");
  }

  createEpisode(
    _seasonId: string,
    _dto: { number: number; name: string },
  ): Promise<unknown> {
    throw new NotImplementedException("AdminContentService.createEpisode");
  }

  /** Unparseable names are reported, not guessed at (F-023). */
  bulkCreateEpisodes(
    _seasonId: string,
    fileNames: string[],
  ): Promise<{ created: number; skipped: string[] }> {
    const skipped = fileNames.filter((n) => parseEpisodeFilename(n) === null);
    void skipped;
    throw new NotImplementedException("AdminContentService.bulkCreateEpisodes");
  }

  updateEpisode(
    _id: string,
    _dto: {
      introStartSec?: number;
      introEndSec?: number;
      creditsStartSec?: number;
    },
  ): Promise<unknown> {
    throw new NotImplementedException("AdminContentService.updateEpisode");
  }

  removeEpisode(_id: string): Promise<void> {
    throw new NotImplementedException("AdminContentService.removeEpisode");
  }
}
