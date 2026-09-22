import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { CreateProfileRequest, UpdateProfileRequest } from '@myflix/shared';
import { CurrentUser, type RequestUser } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProfilesService } from './profiles.service';

@Controller('profiles')
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.profiles.list(user.userId);
  }

  @Post()
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateProfileRequest) {
    await this.profiles.assertUnderProfileLimit(user.userId);
    return this.profiles.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateProfileRequest,
  ) {
    return this.profiles.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.profiles.remove(user.userId, id);
  }

  /** Sets the `pid` cookie every personalised endpoint reads (HLD §2.3). */
  @Post(':id/select')
  @HttpCode(204)
  select(
    @CurrentUser() _user: RequestUser,
    @Param('id') _id: string,
    @Res({ passthrough: true }) _res: Response,
  ) {
    // TODO(phase-2): verify ownership, then res.cookie('pid', id, { httpOnly: true }).
    return;
  }
}
