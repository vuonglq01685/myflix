import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import type Redis from 'ioredis';
import type {
  CatalogRowsResponse,
  GenreRef,
  Page,
  SearchResultItem,
  TitleDetail,
} from '@myflix/shared';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { CACHE_KEYS } from './row-definitions';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // TODO(phase-4): assemble billboard + rows. Personalised rows come straight
  // from Postgres; global rows go through CACHE_KEYS.globalRows with a 60s TTL.
  getRows(_profileId: string, _rowLimit: number, _itemLimit: number): Promise<CatalogRowsResponse> {
    throw new NotImplementedException('CatalogService.getRows');
  }

  getTitle(_profileId: string, _titleId: string): Promise<TitleDetail> {
    throw new NotImplementedException('CatalogService.getTitle');
  }

  // TODO(phase-5): FTS on search_vector first; top up with pg_trgm similarity
  // above 0.3 when fewer than 5 rows come back (ADR-011).
  search(_query: string, _limit: number): Promise<SearchResultItem[]> {
    throw new NotImplementedException('CatalogService.search');
  }

  listGenres(): Promise<Array<GenreRef & { titleCount: number }>> {
    throw new NotImplementedException('CatalogService.listGenres');
  }

  listByGenre(_slug: string, _cursor?: string): Promise<Page<SearchResultItem>> {
    throw new NotImplementedException('CatalogService.listByGenre');
  }

  /** Called whenever an admin publishes, unpublishes or edits a title. */
  async invalidate(titleId: string): Promise<void> {
    const stream = this.redis.scanStream({ match: 'rows:global:*', count: 100 });
    for await (const keys of stream) {
      if ((keys as string[]).length) await this.redis.del(...(keys as string[]));
    }
    await this.redis.del(CACHE_KEYS.titleDetail(titleId));
  }
}
