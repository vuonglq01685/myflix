/**
 * Stable business error codes (API spec §1.3). `errorCode` is the contract the
 * client branches on; `message` is free to change without breaking anything.
 */
export const ErrorCode = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  TOKEN_REUSED: "TOKEN_REUSED",
  PROFILE_LIMIT_REACHED: "PROFILE_LIMIT_REACHED",
  PROFILE_NOT_OWNED: "PROFILE_NOT_OWNED",
  ASSET_NOT_READY: "ASSET_NOT_READY",
  TITLE_NOT_PUBLISHABLE: "TITLE_NOT_PUBLISHABLE",
  UPLOAD_INCOMPLETE: "UPLOAD_INCOMPLETE",
  JOB_ALREADY_RUNNING: "JOB_ALREADY_RUNNING",
  SIGNED_URL_EXPIRED: "SIGNED_URL_EXPIRED",
  UNSUPPORTED_SOURCE_FORMAT: "UNSUPPORTED_SOURCE_FORMAT",
  STORAGE_QUOTA_EXCEEDED: "STORAGE_QUOTA_EXCEEDED",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_CREDENTIALS: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REUSED: 401,
  PROFILE_LIMIT_REACHED: 422,
  PROFILE_NOT_OWNED: 403,
  ASSET_NOT_READY: 422,
  TITLE_NOT_PUBLISHABLE: 422,
  UPLOAD_INCOMPLETE: 422,
  JOB_ALREADY_RUNNING: 409,
  SIGNED_URL_EXPIRED: 410,
  UNSUPPORTED_SOURCE_FORMAT: 422,
  STORAGE_QUOTA_EXCEEDED: 507,
};

/** The single error envelope every endpoint returns (HLD §8.2). */
export interface ApiErrorBody {
  statusCode: number;
  errorCode: ErrorCode | "INTERNAL_ERROR" | "VALIDATION_ERROR" | "NOT_FOUND";
  message: string;
  correlationId: string;
  timestamp: string;
}

export const MAX_PROFILES_PER_USER = 5;
