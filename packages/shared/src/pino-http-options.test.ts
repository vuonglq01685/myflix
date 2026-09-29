import { test } from "node:test";
import assert from "node:assert/strict";
import { genReqId, PINO_HTTP_OPTIONS } from "./pino-http-options";
import { LOG_REDACT_CONFIG } from "./log-redact";

// UUID v4 shape, as emitted by crypto.randomUUID(). Copied from
// correlation-id.test.ts.
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Task 14: shared pino-http options ───────────────────────────────────────
test("genReqId echoes a valid client-supplied correlation id and sets the response header", () => {
  const calls: Array<[string, string]> = [];
  const res = { setHeader: (k: string, v: string) => calls.push([k, v]) };

  const id = genReqId(
    { headers: { "x-correlation-id": "t7-probe-0001" } } as never,
    res as never,
  );

  assert.equal(id, "t7-probe-0001");
  assert.deepEqual(calls, [["X-Correlation-Id", "t7-probe-0001"]]);
});

test("genReqId generates a UUID v4 when the header is malformed", () => {
  const calls: Array<[string, string]> = [];
  const res = { setHeader: (k: string, v: string) => calls.push([k, v]) };

  const id = genReqId(
    { headers: { "x-correlation-id": "bad id" } } as never,
    res as never,
  );

  assert.match(id, UUID_V4);
  assert.notEqual(id, "bad id");
});

test("genReqId takes the first value when the header arrives as an array", () => {
  const calls: Array<[string, string]> = [];
  const res = { setHeader: (k: string, v: string) => calls.push([k, v]) };

  const id = genReqId(
    { headers: { "x-correlation-id": ["a1", "a2"] } } as never,
    res as never,
  );

  assert.equal(id, "a1");
});

test("PINO_HTTP_OPTIONS carries the correlationId attribute key, quiet logger, and shared redact config", () => {
  assert.deepEqual(PINO_HTTP_OPTIONS.customAttributeKeys, {
    reqId: "correlationId",
  });
  assert.equal(PINO_HTTP_OPTIONS.quietReqLogger, true);
  assert.equal(PINO_HTTP_OPTIONS.redact, LOG_REDACT_CONFIG);
});
