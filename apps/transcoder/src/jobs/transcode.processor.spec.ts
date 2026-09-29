import { PinoLogger } from "nestjs-pino";
import { __resetOutOfContextForTests } from "nestjs-pino/PinoLogger";
import pinoHttp from "pino-http";
import type { Job } from "bullmq";
import type { TranscodeJobData } from "@myflix/shared";
import type { ConfigService } from "@nestjs/config";
import { TranscodeProcessor } from "./transcode.processor";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import type { FfmpegService } from "../ffmpeg/ffmpeg.service";
import type { KeyframeVerifier } from "../ffmpeg/keyframe-verifier";
import type { JobEventsPublisher } from "../events/job-events.publisher";

// UUID v4 shape, verbatim from Task 2's correlation-id.test.ts case
// resolveCorrelationId(undefined) — named UUID_V4_REGEX per Task 6's
// Interfaces (S5) (R2-B1).
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createMemStream(): {
  logs: Record<string, unknown>[];
  stream: { write(msg: string): void };
} {
  const logs: Record<string, unknown>[] = [];
  return {
    logs,
    stream: {
      write(msg: string) {
        logs.push(JSON.parse(msg) as Record<string, unknown>);
      },
    },
  };
}

describe("TranscodeProcessor", () => {
  let logs: Record<string, unknown>[];
  let processor: TranscodeProcessor;
  let storageMock: { buckets: { staging: string }; deletePrefix: jest.Mock };

  beforeEach(() => {
    // NS1 — PinoLogger.root is only assigned by Nest's real configure() at
    // app.init()/app.listen(); rebuild it by hand with pino-http (a direct
    // dependency of apps/transcoder — not `pino` itself).
    const memStream = createMemStream();
    logs = memStream.logs;
    __resetOutOfContextForTests();
    new PinoLogger({ pinoHttp: [{}, memStream.stream] });
    (PinoLogger as unknown as { root: unknown }).root = pinoHttp(
      {},
      memStream.stream,
    ).logger;

    const prismaMock = {} as unknown as PrismaService;
    storageMock = {
      buckets: { staging: "myflix-staging" },
      deletePrefix: jest.fn().mockRejectedValue(new Error("x")),
    };
    const ffmpegMock = {} as unknown as FfmpegService;
    const keyframesMock = {} as unknown as KeyframeVerifier;
    const eventsMock = {} as unknown as JobEventsPublisher;
    const configMock = {} as unknown as ConfigService;

    processor = new TranscodeProcessor(
      prismaMock,
      storageMock as unknown as StorageService,
      ffmpegMock,
      keyframesMock,
      eventsMock,
      configMock,
      new PinoLogger({ pinoHttp: [{}, memStream.stream] }),
    );
  });

  it("attaches the job's correlationId to every log line (AC9)", async () => {
    const fakeJob = {
      data: { assetId: "a1", jobId: "j1", correlationId: "t12-probe-0001" },
    } as unknown as Job<TranscodeJobData>;

    await processor.process(fakeJob).catch(() => undefined);

    expect(logs.length).toBeGreaterThanOrEqual(3);
    const messages = logs.map((line) => line.msg ?? line.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        "job started",
        "staging cleanup failed",
        "job finished",
      ]),
    );
    for (const line of logs) {
      expect(line.correlationId).toBe("t12-probe-0001");
    }
  });

  it("generates a fresh UUID v4 correlationId when the job carries none (T12b)", async () => {
    const fakeJob = {
      data: { assetId: "a1", jobId: "j1" },
    } as unknown as Job<TranscodeJobData>;

    await processor.process(fakeJob).catch(() => undefined);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const correlationId = logs[0]!.correlationId;
    expect(typeof correlationId).toBe("string");
    expect(correlationId as string).toMatch(UUID_V4_REGEX);
    for (const line of logs) {
      expect(line.correlationId).toBe(correlationId);
    }
  });

  it("logs a Worker error event through Pino instead of a raw stack trace (T14)", () => {
    const errorSpy = jest.spyOn(PinoLogger.prototype, "error");

    processor.onWorkerError(new Error("boom"));

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String),
    );

    errorSpy.mockRestore();
  });
});
