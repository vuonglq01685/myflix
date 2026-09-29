import { NextResponse, type NextRequest } from "next/server";
// Subpath, not the "@myflix/shared" barrel: the barrel pulls in @node-rs/argon2, which cannot load on the Edge runtime.
import { resolveCorrelationId } from "@myflix/shared/correlation-id";
import { logger } from "./lib/logger";

/**
 * Cheap redirects only. This is a UX shortcut, not a security control — the
 * real authorisation boundary is RolesGuard in the API (ADR-009), because a
 * cookie's presence proves nothing about its contents.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const correlationId = resolveCorrelationId(
    request.headers.get("x-correlation-id"), // mission D9
  );
  logger.info({
    msg: "request",
    method: request.method,
    path: pathname,
    correlationId,
  });
  const hasSession = request.cookies.has("refresh_token");
  const hasProfile = request.cookies.has("pid");

  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (!hasProfile && pathname !== "/profiles") {
    return NextResponse.redirect(new URL("/profiles", request.url));
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-correlation-id", correlationId); // mission D9
  return NextResponse.next({ request: { headers: forwardedHeaders } });
}

export const config = {
  matcher: [
    "/",
    "/browse/:path*",
    "/title/:path*",
    "/search",
    "/genre/:path*",
    "/my-list",
    "/watch/:path*",
    "/admin/:path*",
  ],
};
