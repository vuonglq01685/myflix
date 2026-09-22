import { Injectable, NotImplementedException } from '@nestjs/common';
import type { RowItem } from '@myflix/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MyListService {
  constructor(private readonly prisma: PrismaService) {}

  list(_profileId: string): Promise<RowItem[]> {
    throw new NotImplementedException('MyListService.list');
  }

  /** Idempotent by contract — the composite PK makes upsert the natural fit. */
  async add(profileId: string, titleId: string): Promise<void> {
    await this.prisma.myListItem.upsert({
      where: { profileId_titleId: { profileId, titleId } },
      update: {},
      create: { profileId, titleId },
    });
  }

  async remove(profileId: string, titleId: string): Promise<void> {
    await this.prisma.myListItem.deleteMany({ where: { profileId, titleId } });
  }
}
