import { Module } from "@nestjs/common";
import { MediaUrlService } from "./media-url.service";
import { PlaybackController } from "./playback.controller";
import { PlaybackService } from "./playback.service";
import { ProgressService } from "./progress.service";

@Module({
  controllers: [PlaybackController],
  providers: [PlaybackService, ProgressService, MediaUrlService],
  exports: [MediaUrlService, ProgressService],
})
export class PlaybackModule {}
