import { execFile } from "node:child_process";
import { GpuProbeService } from "./gpu-probe.service";

const GPU_STALE_MS = 30_000; // mission D7, đã có — mirrors gpu-probe.service.ts (private module constant, cannot import)

type ExecFileCallback = (
  error: Error | null,
  stdout: string,
  stderr: string,
) => void;
type ExecFileMockArgs = [
  command: string,
  args: string[],
  options: { timeout: number },
  callback: ExecFileCallback,
];

jest.mock("node:child_process", () => ({
  execFile: jest.fn(),
}));

const mockExecFile = execFile as unknown as jest.Mock<void, ExecFileMockArgs>;

function callRunCheck(service: GpuProbeService): Promise<void> {
  return (service as unknown as { runCheck(): Promise<void> }).runCheck();
}

function latestCallback(): ExecFileCallback {
  const { calls } = mockExecFile.mock;
  const lastCall = calls[calls.length - 1];
  if (!lastCall) throw new Error("execFile was not called");
  return lastCall[3];
}

describe("GpuProbeService", () => {
  let service: GpuProbeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GpuProbeService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("read() is false before any check has run", () => {
    expect(service.read()).toBe(false);
  });

  it("read() is true after a successful runCheck()", async () => {
    const promise = callRunCheck(service);
    latestCallback()(null, "", "");
    await promise;

    expect(service.read()).toBe(true);
  });

  it("read() is false after a failed runCheck()", async () => {
    const promise = callRunCheck(service);
    latestCallback()(new Error("nvidia-smi exited with code 1"), "", "");
    await promise;

    expect(service.read()).toBe(false);
  });

  it("guards against overlapping nvidia-smi runs while a check is still in flight (A3 S2)", async () => {
    const first = callRunCheck(service);
    expect(mockExecFile).toHaveBeenCalledTimes(1);
    const firstCallback = latestCallback();

    void callRunCheck(service); // second call arrives while the first is still hanging
    expect(mockExecFile).toHaveBeenCalledTimes(1); // guarded — no overlapping nvidia-smi

    firstCallback(null, "", "");
    await first;

    const third = callRunCheck(service);
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    latestCallback()(null, "", "");
    await third;
  });

  it("read() is false once GPU_STALE_MS has elapsed since the last successful check", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(0);

    const promise = callRunCheck(service);
    latestCallback()(null, "", "");
    await promise;
    expect(service.read()).toBe(true);

    nowSpy.mockReturnValue(GPU_STALE_MS + 1);
    expect(service.read()).toBe(false);
  });
});
