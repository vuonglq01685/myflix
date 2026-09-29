// mission D10: exactly the 3 sensitive headers; no body-field list because
// pino-http does not log the request/response body by default.
export const LOG_REDACT_CONFIG = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
  ],
  censor: "[REDACTED]",
};
