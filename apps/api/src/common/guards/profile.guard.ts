import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { ErrorCode } from "@myflix/shared";
import { PrismaService } from "../../prisma/prisma.service";
import { BusinessError } from "../filters/all-exceptions.filter";
import type { RequestUser } from "../decorators";

/**
 * Personalised endpoints need a profile, and the profile must belong to the
 * authenticated user — otherwise anyone could read another household
 * member's history by swapping a cookie (AC-040-5).
 */
@Injectable()
export class ProfileGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as RequestUser | undefined;
    const profileId = req.cookies?.pid as string | undefined;

    if (!user || !profileId) {
      throw new BusinessError(ErrorCode.PROFILE_NOT_OWNED, "Chưa chọn hồ sơ");
    }

    const owned = await this.prisma.profile.count({
      where: { id: profileId, userId: user.userId },
    });
    if (owned === 0) {
      throw new BusinessError(
        ErrorCode.PROFILE_NOT_OWNED,
        "Hồ sơ không thuộc tài khoản này",
      );
    }

    req.profileId = profileId;
    return true;
  }
}
