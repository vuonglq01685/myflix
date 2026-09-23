import { NextResponse, type NextRequest } from 'next/server';
import { logger } from './lib/logger';

/**
 * Cheap redirects only. This is a UX shortcut, not a security control — the
 * real authorisation boundary is RolesGuard in the API (ADR-009), because a
 * cookie's presence proves nothing about its contents.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  logger.info({ msg: 'request', method: request.method, path: pathname });
  const hasSession = request.cookies.has('refresh_token');
  const hasProfile = request.cookies.has('pid');

  if (!hasSession) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  if (!hasProfile && pathname !== '/profiles') {
    return NextResponse.redirect(new URL('/profiles', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/browse/:path*', '/title/:path*', '/search', '/genre/:path*', '/my-list', '/watch/:path*', '/admin/:path*'],
};
