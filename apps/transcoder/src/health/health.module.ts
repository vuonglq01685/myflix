import { Module } from "@nestjs/common";
import { GpuProbeController } from "./gpu-probe.controller";
import { GpuProbeService } from "./gpu-probe.service";

@Module({
  controllers: [GpuProbeController],
  providers: [GpuProbeService],
})
export class HealthModule {}
