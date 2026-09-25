import { Module } from "@nestjs/common";
import { PlaybackModule } from "../playback/playback.module";
import { MaintenanceService } from "./maintenance.service";

@Module({
  imports: [PlaybackModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
