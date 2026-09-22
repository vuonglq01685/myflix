import type { ApiErrorBody } from '@myflix/shared';

/**
 * Browser calls go through nginx at /api; server components talk to the api
 * container directly and skip the proxy hop.
 */
const baseUrl = () =>
  typeof window === 'undefined'
    ? `${process.env.API_INTERNAL_URL ?? 'http://api:4000'}/api`
    : (process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api');

export class ApiError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body ?? {
        statusCode: response.status,
        errorCode: 'INTERNAL_ERROR',
        message: response.statusText,
        correlationId: '',
        timestamp: new Date().toISOString(),
      },
    );
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
