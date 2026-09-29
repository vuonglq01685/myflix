import { test } from "node:test";
import assert from "node:assert/strict";
import { LOG_REDACT_CONFIG } from "./log-redact";

// ── AC5/AC6/AC9/AC10: pino redact config (mission D10) ──────────────────────
test("LOG_REDACT_CONFIG.paths covers exactly the 3 sensitive headers, in order", () => {
  assert.deepEqual(LOG_REDACT_CONFIG.paths, [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
  ]);
});

test("LOG_REDACT_CONFIG.censor is the fixed placeholder", () => {
  assert.equal(LOG_REDACT_CONFIG.censor, "[REDACTED]");
});
