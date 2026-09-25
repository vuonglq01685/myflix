import { Injectable, NotImplementedException } from "@nestjs/common";
import {
  ErrorCode,
  MAX_PROFILES_PER_USER,
  type CreateProfileRequest,
  type ProfileSummary,
  type UpdateProfileRequest,
} from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { BusinessError } from "../common/filters/all-exceptions.filter";

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string): Promise<ProfileSummary[]> {
    return this.prisma.profile
      .findMany({ where: { userId }, orderBy: { createdAt: "asc" } })
      .then((rows) =>
        rows.map((p) => ({
          id: p.id,
          name: p.name,
          avatarUrl: p.avatarKey ? `/images/${p.avatarKey}` : null,
          isKids: p.isKids,
        })),
      );
  }

  /** BR-002 / DI-06 — the 5-profile cap has no DB expression, so it lives here. */
  async assertUnderProfileLimit(userId: string): Promise<void> {
    const count = await this.prisma.profile.count({ where: { userId } });
    if (count >= MAX_PROFILES_PER_USER) {
      throw new BusinessError(
        ErrorCode.PROFILE_LIMIT_REACHED,
        `Tối đa ${MAX_PROFILES_PER_USER} hồ sơ mỗi tài khoản`,
      );
    }
  }

  create(_userId: string, _dto: CreateProfileRequest): Promise<ProfileSummary> {
    throw new NotImplementedException("ProfilesService.create");
  }

  update(
    _userId: string,
    _id: string,
    _dto: UpdateProfileRequest,
  ): Promise<ProfileSummary> {
    throw new NotImplementedException("ProfilesService.update");
  }

  // TODO(phase-2): refuse to delete the last remaining profile.
  remove(_userId: string, _id: string): Promise<void> {
    throw new NotImplementedException("ProfilesService.remove");
  }
}
