// mission D9, US2 AC7
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidCorrelationId(v: unknown): v is string {
  return typeof v === "string" && CORRELATION_ID_PATTERN.test(v);
}

export function generateCorrelationId(): string {
  // Web Crypto global, not node:crypto — runs on Node and the Next.js Edge
  // Runtime alike. mission D9 + design Finding 4.
  return globalThis.crypto.randomUUID();
}

export function resolveCorrelationId(candidate?: string | null): string {
  return isValidCorrelationId(candidate) ? candidate : generateCorrelationId();
}
