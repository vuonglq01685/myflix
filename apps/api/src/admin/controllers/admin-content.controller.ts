import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { UserRole, type CreateTitleRequest } from "@myflix/shared";
import { Roles } from "../../common/decorators";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { AdminContentService } from "../services/admin-content.service";

@Controller("admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminContentController {
  constructor(private readonly content: AdminContentService) {}

  @Get("titles")
  listTitles(
    @Query("status") status?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.content.listTitles({ status, cursor });
  }

  @Post("titles")
  createTitle(@Body() dto: CreateTitleRequest) {
    return this.content.createTitle(dto);
  }

  @Get("titles/:id")
  getTitle(@Param("id") id: string) {
    return this.content.getTitle(id);
  }

  @Patch("titles/:id")
  updateTitle(
    @Param("id") id: string,
    @Body() dto: Partial<CreateTitleRequest>,
  ) {
    return this.content.updateTitle(id, dto);
  }

  /** 422 TITLE_NOT_PUBLISHABLE unless at least one asset is READY (DI-07). */
  @Post("titles/:id/publish")
  publish(@Param("id") id: string) {
    return this.content.publish(id);
  }

  @Post("titles/:id/unpublish")
  unpublish(@Param("id") id: string) {
    return this.content.unpublish(id);
  }

  /** Archive first, enqueue the object keys, then delete rows — never the
   *  other way round, or the keys are lost forever (doc 04 §6). */
  @Delete("titles/:id")
  removeTitle(@Param("id") id: string) {
    return this.content.removeTitle(id);
  }

  @Post("titles/:id/seasons")
  createSeason(
    @Param("id") titleId: string,
    @Body() dto: { number: number; name?: string },
  ) {
    return this.content.createSeason(titleId, dto);
  }

  @Patch("seasons/:id")
  updateSeason(
    @Param("id") id: string,
    @Body() dto: { name?: string; synopsis?: string },
  ) {
    return this.content.updateSeason(id, dto);
  }

  @Delete("seasons/:id")
  removeSeason(@Param("id") id: string) {
    return this.content.removeSeason(id);
  }

  @Post("seasons/:id/episodes")
  createEpisode(
    @Param("id") seasonId: string,
    @Body() dto: { number: number; name: string },
  ) {
    return this.content.createEpisode(seasonId, dto);
  }

  @Post("seasons/:id/episodes/bulk")
  bulkCreateEpisodes(
    @Param("id") seasonId: string,
    @Body() dto: { fileNames: string[] },
  ) {
    return this.content.bulkCreateEpisodes(seasonId, dto.fileNames);
  }

  @Patch("episodes/:id")
  updateEpisode(
    @Param("id") id: string,
    @Body()
    dto: {
      introStartSec?: number;
      introEndSec?: number;
      creditsStartSec?: number;
    },
  ) {
    return this.content.updateEpisode(id, dto);
  }

  @Delete("episodes/:id")
  removeEpisode(@Param("id") id: string) {
    return this.content.removeEpisode(id);
  }
}
