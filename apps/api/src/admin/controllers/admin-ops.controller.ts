import { Controller, Get, Param, Patch, Post, Query, Body, UseGuards } from '@nestjs/common';
import { UserRole } from '@myflix/shared';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminOpsService } from '../services/admin-ops.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOpsController {
  constructor(private readonly ops: AdminOpsService) {}

  @Get('jobs')
  listJobs(@Query('status') status?: string) {
    return this.ops.listJobs(status);
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.ops.getJob(id);
  }

  /** 409 JOB_ALREADY_RUNNING while the job is active. */
  @Post('jobs/:id/retry')
  retryJob(@Param('id') id: string) {
    return this.ops.retryJob(id);
  }

  @Post('jobs/:id/cancel')
  cancelJob(@Param('id') id: string) {
    return this.ops.cancelJob(id);
  }

  @Get('stats')
  stats() {
    return this.ops.stats();
  }

  @Get('storage')
  storage() {
    return this.ops.storageUsage();
  }

  /** F-018: drop originals for assets already verified READY, cutting the
   *  storage multiplier from ~3x to ~2x. */
  @Post('storage/purge-sources')
  purgeSources() {
    return this.ops.purgeSources();
  }

  @Get('users')
  listUsers() {
    return this.ops.listUsers();
  }

  @Patch('users/:id')
  updateUser(@Param('id') id: string, @Body() dto: { role?: UserRole; isActive?: boolean }) {
    return this.ops.updateUser(id, dto);
  }
}
