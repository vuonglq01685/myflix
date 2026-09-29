import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { GpuProbeController } from "./gpu-probe.controller";
import type { GpuProbeService } from "./gpu-probe.service";

function makeController(encoder: string, probeOk: boolean): GpuProbeController {
  const config = {
    get: jest.fn().mockReturnValue(encoder),
  } as unknown as ConfigService;
  const probe = {
    read: jest.fn().mockReturnValue(probeOk),
  } as unknown as GpuProbeService;
  return new GpuProbeController(config, probe);
}

describe("GpuProbeController", () => {
  it("returns not_required when TRANSCODE_ENCODER does not end with _nvenc, regardless of probe.read()", () => {
    const controller = makeController("libx264", true);
    expect(controller.check()).toEqual({ gpu: "not_required" });
  });

  it("returns ok when encoder is nvenc and probe.read() is true", () => {
    const controller = makeController("h264_nvenc", true);
    expect(controller.check()).toEqual({ gpu: "ok" });
  });

  it("throws ServiceUnavailableException with { gpu: 'down' } when encoder is nvenc and probe.read() is false", () => {
    const controller = makeController("h264_nvenc", false);
    expect(() => controller.check()).toThrow(ServiceUnavailableException);
    try {
      controller.check();
      throw new Error("expected check() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        gpu: "down",
      });
    }
  });
});
