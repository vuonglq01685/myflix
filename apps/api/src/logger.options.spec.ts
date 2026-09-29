import pinoHttp from "pino-http";
import request from "supertest";
import http from "node:http";
import { genReqId, PINO_HTTP_OPTIONS } from "./logger.options";

describe("genReqId", () => {
  it("echoes a valid client-supplied correlation id and sets the response header unconditionally", () => {
    const reqStub = { headers: { "x-correlation-id": "t7-probe-0001" } };
    const resStub = { setHeader: jest.fn() };

    const id = genReqId(reqStub as never, resStub as never);

    expect(resStub.setHeader).toHaveBeenCalledWith(
      "X-Correlation-Id",
      "t7-probe-0001",
    );
    expect(id).toBe("t7-probe-0001");
  });
});

describe("PINO_HTTP_OPTIONS", () => {
  it("tags every log line with correlationId and redacts the 3 sensitive headers, never the body (AC5/AC10/NB1)", async () => {
    const lines: string[] = [];
    // pino.DestinationStream duck type: pino only ever calls .write(string).
    const memStream = { write: (chunk: string) => lines.push(chunk) };

    const logger = pinoHttp(
      { ...PINO_HTTP_OPTIONS, genReqId: () => "t7-probe-0001" },
      memStream,
    );

    const server = http.createServer((req, res) => {
      logger(req, res);
      // Covers a log line emitted DURING request handling, not just the
      // "request completed" summary line (S7).
      req.log.info("in-request");
      req.resume();
      res.setHeader("Set-Cookie", "refresh_token=rotated");
      res.end(JSON.stringify({ ok: true }));
    });

    await request(server)
      .post("/")
      .set("Cookie", "refresh_token=t13; pid=p13")
      .set("Authorization", "Bearer secret-token")
      .send({ password: "T13-Probe-Pass-9" })
      .expect(200);

    const entries = lines
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.correlationId).toBe("t7-probe-0001");
    }

    const completed = entries.find(
      (entry) => entry.msg === "request completed",
    );
    expect(completed).toBeDefined();
    expect(completed.req.headers.authorization).toBe("[REDACTED]");
    expect(completed.req.headers.cookie).toBe("[REDACTED]");
    expect(completed.res.headers["set-cookie"]).toBe("[REDACTED]");

    const rawOutput = JSON.stringify(entries);
    expect(rawOutput).not.toContain("secret-token");
    expect(rawOutput).not.toContain("refresh_token=t13");
    expect(rawOutput).not.toContain("refresh_token=rotated");
    // AC10 — "0 dòng mang body": pino-http does not log the body by default;
    // this assertion confirms no config here accidentally turns it on.
    expect(rawOutput).not.toContain("T13-Probe-Pass-9");
    for (const entry of entries) {
      expect(entry.req?.body).toBeUndefined();
      expect(entry.res?.body).toBeUndefined();
    }
  });
});
