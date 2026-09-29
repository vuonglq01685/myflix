import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GpuProbeService } from "./gpu-probe.service";

type GpuState = "ok" | "not_required" | "down"; // transcoder tự trả 3/4 giá trị — "unreachable" là diễn giải phía api

@Controller("health")
export class GpuProbeController {
  constructor(
    private readonly config: ConfigService,
    private readonly probe: GpuProbeService,
  ) {}

  @Get("gpu")
  check(): { gpu: GpuState } {
    const encoder = this.config.get<string>("TRANSCODE_ENCODER", "h264_nvenc");
    if (!encoder.endsWith("_nvenc")) return { gpu: "not_required" }; // Q3/D7 — nhánh CPU

    if (this.probe.read()) return { gpu: "ok" };
    throw new ServiceUnavailableException({ gpu: "down" }); // body {"gpu":"down"} + HTTP 503, đúng D7
  }
}
