import { Controller, DefaultValuePipe, Get, ParseIntPipe, Param, Query, UseGuards } from '@nestjs/common';
import { SEARCH_MIN_QUERY_LENGTH } from '@myflix/shared';
import { BadRequestException } from '@nestjs/common';
import { CurrentProfile } from '../common/decorators';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ProfileGuard } from '../common/guards/profile.guard';
import { CatalogService } from './catalog.service';

@Controller('catalog')
@UseGuards(JwtAuthGuard, ProfileGuard)
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('rows')
  rows(
    @CurrentProfile() profileId: string,
    @Query('rowLimit', new DefaultValuePipe(12), ParseIntPipe) rowLimit: number,
    @Query('itemLimit', new DefaultValuePipe(20), ParseIntPipe) itemLimit: number,
  ) {
    return this.catalog.getRows(profileId, rowLimit, itemLimit);
  }

  @Get('titles/:id')
  title(@CurrentProfile() profileId: string, @Param('id') id: string) {
    return this.catalog.getTitle(profileId, id);
  }

  @Get('search')
  search(
    @Query('q') q: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    if (!q || q.trim().length < SEARCH_MIN_QUERY_LENGTH) {
      throw new BadRequestException(`q phải có ít nhất ${SEARCH_MIN_QUERY_LENGTH} ký tự`);
    }
    return this.catalog.search(q.trim(), limit);
  }

  @Get('genres')
  genres() {
    return this.catalog.listGenres();
  }

  @Get('genres/:slug')
  byGenre(@Param('slug') slug: string, @Query('cursor') cursor?: string) {
    return this.catalog.listByGenre(slug, cursor);
  }
}
