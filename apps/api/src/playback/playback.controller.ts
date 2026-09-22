import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { PlaybackSessionRequest, ProgressRequest, QoeEventRequest } from '@myflix/shared';
import { CurrentProfile } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProfileGuard } from '../common/guards/profile.guard';
import { PlaybackService } from './playback.service';
import { ProgressService } from './progress.service';

@Controller('playback')
@UseGuards(JwtAuthGuard, ProfileGuard)
export class PlaybackController {
  constructor(
    private readonly playback: PlaybackService,
    private readonly progress: ProgressService,
  ) {}

  @Post('session')
  @HttpCode(200)
  session(@CurrentProfile() profileId: string, @Body() dto: PlaybackSessionRequest) {
    return this.playback.createSession(profileId, dto.assetId);
  }

  @Post('session/:sessionId/renew')
  @HttpCode(200)
  renew(@CurrentProfile() profileId: string, @Param('sessionId') sessionId: string) {
    return this.playback.renewSession(profileId, sessionId);
  }

  /** Hot path: Redis only, empty body, no Postgres (ADR-012). */
  @Post('progress')
  @HttpCode(204)
  async recordProgress(@CurrentProfile() profileId: string, @Body() dto: ProgressRequest) {
    await this.progress.record({ profileId, ...dto });
  }

  @Post('events')
  @HttpCode(204)
  qoe(@CurrentProfile() profileId: string, @Body() dto: QoeEventRequest) {
    return this.playback.recordQoe(profileId, dto);
  }
}
