import { Injectable, NotImplementedException } from "@nestjs/common";
import {
  AssetStatus,
  ErrorCode,
  type PlaybackSessionResponse,
  type QoeEventRequest,
} from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { BusinessError } from "../common/filters/all-exceptions.filter";
import { MediaUrlService } from "./media-url.service";

@Injectable()
export class PlaybackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaUrls: MediaUrlService,
  ) {}

  /** DI-10 — an asset that is not READY can never be played. */
  async assertPlayable(assetId: string): Promise<void> {
    const asset = await this.prisma.mediaAsset.findUnique({
      where: { id: assetId },
      select: { status: true },
    });
    if (!asset || asset.status !== AssetStatus.READY) {
      throw new BusinessError(
        ErrorCode.ASSET_NOT_READY,
        "Nội dung đang được xử lý, vui lòng thử lại sau",
      );
    }
  }

  // TODO(phase-2/4): after assertPlayable, sign master.m3u8 + sprite.vtt,
  // load the resume position, episode markers and the next-episode reference.
  createSession(
    _profileId: string,
    _assetId: string,
  ): Promise<PlaybackSessionResponse> {
    throw new NotImplementedException("PlaybackService.createSession");
  }

  renewSession(_profileId: string, _sessionId: string) {
    throw new NotImplementedException("PlaybackService.renewSession");
  }

  recordQoe(_profileId: string, _event: QoeEventRequest): Promise<void> {
    throw new NotImplementedException("PlaybackService.recordQoe");
  }
}
