import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCorrelationId, resolveCorrelationId } from "./correlation-id";

// UUID v4 shape, as emitted by crypto.randomUUID().
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── AC7: correlation id resolution ──────────────────────────────────────────
test("resolveCorrelationId(undefined) generates a UUID v4", () => {
  assert.match(resolveCorrelationId(undefined), UUID_V4);
});

test("resolveCorrelationId returns a valid candidate unchanged", () => {
  assert.equal(resolveCorrelationId("t7-probe-0001"), "t7-probe-0001");
});

test("resolveCorrelationId regenerates when the candidate is too long (>64)", () => {
  const tooLong = "a".repeat(65);
  const resolved = resolveCorrelationId(tooLong);
  assert.notEqual(resolved, tooLong);
  assert.match(resolved, UUID_V4);
});

test("resolveCorrelationId regenerates when the candidate contains a newline", () => {
  const withNewline = "bad\nid";
  const resolved = resolveCorrelationId(withNewline);
  assert.notEqual(resolved, withNewline);
  assert.match(resolved, UUID_V4);
});

test("isValidCorrelationId rejects a value with whitespace", () => {
  assert.equal(isValidCorrelationId("bad id"), false);
});
