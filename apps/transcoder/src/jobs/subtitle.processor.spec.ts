import { PinoLogger } from "nestjs-pino";
import { __resetOutOfContextForTests } from "nestjs-pino/PinoLogger";
import pinoHttp from "pino-http";
import type { Job } from "bullmq";
import { SubtitleProcessor, type SubtitleJobData } from "./subtitle.processor";

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

describe("SubtitleProcessor", () => {
  let logs: Record<string, unknown>[];
  let processor: SubtitleProcessor;

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

    processor = new SubtitleProcessor(
      new PinoLogger({ pinoHttp: [{}, memStream.stream] }),
    );
  });

  it("logs a job-started line carrying the job's correlationId before throwing (B2, AC9)", async () => {
    const fakeJob = {
      data: {
        assetId: "a1",
        subtitleTrackId: "st1",
        sourceKey: "raw/a1.srt",
        lang: "vi",
        correlationId: "t12-probe-0002",
      },
    } as unknown as Job<SubtitleJobData>;

    await processor.process(fakeJob).catch(() => undefined);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    const firstLine = logs[0]!;
    const message = (firstLine.msg ?? firstLine.message) as string;
    expect(message).toContain("job started");
    expect(firstLine.correlationId).toBe("t12-probe-0002");
  });
});
