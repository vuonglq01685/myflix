import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveCorrelationId, LOG_REDACT_CONFIG } from "@myflix/shared";

// Matches pino-http's GenReqId<IncomingMessage, ServerResponse> signature —
// exported (not an anonymous arrow) so tests can call it directly.
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const raw = req.headers["x-correlation-id"];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const id = resolveCorrelationId(candidate);
  res.setHeader("X-Correlation-Id", id); // mission D9
  return id;
}

export const PINO_HTTP_OPTIONS = {
  genReqId,
  customAttributeKeys: { reqId: "correlationId" }, // mission D9 nguyên văn
  quietReqLogger: true, // NB1 — bắt buộc: customAttributeKeys một mình không đủ (xác minh thực nghiệm design §4)
  redact: LOG_REDACT_CONFIG, // mission D10
};
