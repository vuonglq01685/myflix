import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@myflix/shared';
import { ROLES_KEY, type RequestUser } from '../decorators';

/**
 * Authorisation lives here, not in the UI. The admin screens sharing a
 * Next.js app with the viewer (ADR-009) changes nothing about the real
 * security boundary, which is this guard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user as RequestUser | undefined;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Không đủ quyền truy cập');
    }
    return true;
  }
}
