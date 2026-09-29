import { PinoLogger } from "nestjs-pino";
import { __resetOutOfContextForTests } from "nestjs-pino/PinoLogger";
import pinoHttp from "pino-http";
import type { Job } from "bullmq";
import { CleanupProcessor } from "./cleanup.processor";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";

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

describe("CleanupProcessor", () => {
  let logs: Record<string, unknown>[];
  let processor: CleanupProcessor;

  beforeEach(() => {
    // NS1 — same PinoLogger.root harness as transcode.processor.spec.ts,
    // rebuilt per-file with its own memStream.
    const memStream = createMemStream();
    logs = memStream.logs;
    __resetOutOfContextForTests();
    new PinoLogger({ pinoHttp: [{}, memStream.stream] });
    (PinoLogger as unknown as { root: unknown }).root = pinoHttp(
      {},
      memStream.stream,
    ).logger;

    const prismaMock = {
      deletionQueue: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "d1",
            bucket: "myflix-media",
            objectKey: "obj1",
            isPrefix: false,
            createdAt: new Date(),
          },
        ]),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const storageMock = {
      deleteObjects: jest.fn().mockRejectedValue(new Error("delete failed")),
      deletePrefix: jest.fn(),
    };

    processor = new CleanupProcessor(
      prismaMock as unknown as PrismaService,
      storageMock as unknown as StorageService,
      new PinoLogger({ pinoHttp: [{}, memStream.stream] }),
    );
  });

  it("attaches a fresh UUID v4 correlationId to every log line (B2)", async () => {
    await processor.process({} as Job);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const lastLine = logs[logs.length - 1]!;
    const message = (lastLine.msg ?? lastLine.message) as string;
    expect(message).toContain("object delete failed");
    expect(lastLine.correlationId).toMatch(UUID_V4_REGEX);
  });

  it("generates a different correlationId on every call (T12b)", async () => {
    await processor.process({} as Job);
    const lengthAfterFirst = logs.length;
    const firstCorrelationId = logs[lengthAfterFirst - 1]!.correlationId;

    await processor.process({} as Job);

    expect(logs.length).toBeGreaterThan(lengthAfterFirst);
    const secondCorrelationId = logs[logs.length - 1]!.correlationId;
    expect(secondCorrelationId).not.toBe(firstCorrelationId);
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
