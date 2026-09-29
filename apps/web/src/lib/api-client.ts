import type { ApiErrorBody } from "@myflix/shared";

/**
 * Browser calls go through nginx at /api; server components talk to the api
 * container directly and skip the proxy hop.
 */
const baseUrl = () =>
  typeof window === "undefined"
    ? `${process.env.API_INTERNAL_URL ?? "http://api:4000"}/api`
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api");

/**
 * Forwards the correlationId middleware stamped on this request so the api
 * log for the same request carries it too (AC8). Browser calls skip this —
 * nginx routes straight to `api`, no header needed. `next/headers` is
 * dynamically imported so it never lands in the client bundle, and reading
 * it outside request scope throws by design, not a bug — caught below.
 */
async function resolveServerCorrelationId(): Promise<string | undefined> {
  if (typeof window !== "undefined") return undefined;
  try {
    const { headers } = await import("next/headers");
    return (await headers()).get("x-correlation-id") ?? undefined; // mission D9
  } catch {
    return undefined;
  }
}

export class ApiError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const correlationId = await resolveServerCorrelationId();
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(correlationId ? { "X-Correlation-Id": correlationId } : {}), // mission D9
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body ?? {
        statusCode: response.status,
        errorCode: "INTERNAL_ERROR",
        message: response.statusText,
        correlationId: "",
        timestamp: new Date().toISOString(),
      },
    );
  }

  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
