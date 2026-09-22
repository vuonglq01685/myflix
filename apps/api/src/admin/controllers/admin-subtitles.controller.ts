import { Controller, Delete, Get, Param, Patch, Post, Body, UseGuards } from '@nestjs/common';
import { UserRole, type UploadSubtitleRequest } from '@myflix/shared';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminSubtitlesService } from '../services/admin-subtitles.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSubtitlesController {
  constructor(private readonly subtitles: AdminSubtitlesService) {}

  /** Multipart upload. Queued on QUEUE_SUBTITLE, which holds no NVENC
   *  session and therefore does not block the transcode queue. */
  @Post('assets/:assetId/subtitles')
  upload(@Param('assetId') assetId: string, @Body() dto: UploadSubtitleRequest) {
    return this.subtitles.upload(assetId, dto);
  }

  @Get('assets/:assetId/subtitles')
  list(@Param('assetId') assetId: string) {
    return this.subtitles.list(assetId);
  }

  @Post('assets/:assetId/subtitles/extract')
  extractEmbedded(@Param('assetId') assetId: string) {
    return this.subtitles.extractEmbedded(assetId);
  }

  @Patch('subtitles/:id')
  update(@Param('id') id: string, @Body() dto: { label?: string; isDefault?: boolean }) {
    return this.subtitles.update(id, dto);
  }

  @Delete('subtitles/:id')
  remove(@Param('id') id: string) {
    return this.subtitles.remove(id);
  }
}
