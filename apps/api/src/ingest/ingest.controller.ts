import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  UserRole,
  type IngestCompleteRequest,
  type IngestInitRequest,
} from "@myflix/shared";
import { Roles } from "../common/decorators";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { IngestService } from "./ingest.service";

@Controller("ingest")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post("init")
  init(@Body() dto: IngestInitRequest) {
    return this.ingest.init(dto);
  }

  @Get(":assetId/part-urls")
  partUrls(
    @Param("assetId") assetId: string,
    @Query("from", new DefaultValuePipe(1), ParseIntPipe) from: number,
    @Query("to", new DefaultValuePipe(50), ParseIntPipe) to: number,
  ) {
    return this.ingest.partUrls(assetId, from, to);
  }

  @Get(":assetId/parts")
  parts(@Param("assetId") assetId: string) {
    return this.ingest.listReceivedParts(assetId);
  }

  @Post("complete")
  @HttpCode(202)
  complete(
    @Body() dto: IngestCompleteRequest,
    @Req() req: Request & { id?: string },
  ) {
    return this.ingest.complete(dto, String(req.id ?? ""));
  }

  @Post(":assetId/abort")
  @HttpCode(204)
  abort(@Param("assetId") assetId: string) {
    return this.ingest.abort(assetId);
  }
}
