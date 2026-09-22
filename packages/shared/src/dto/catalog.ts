import type { AssetStatus, TitleType } from '../enums';

export type RowType = 'CONTINUE' | 'MY_LIST' | 'RECENT' | 'GENRE' | 'REWATCH';

export interface Billboard {
  titleId: string;
  name: string;
  synopsis: string;
  logoUrl: string | null;
  backdropUrl: string;
  trailerPreviewUrl: string | null;
  maturityRating: string | null;
}

export interface RowItem {
  titleId: string;
  name: string;
  thumbnailUrl: string;
  /** Lightweight MP4 for the hover card, never HLS (ADR-007). */
  previewUrl: string | null;
  progressPercent?: number;
  episodeLabel?: string;
  resumeAssetId?: string;
  resumePositionSec?: number;
}

export interface CatalogRow {
  id: string;
  title: string;
  type: RowType;
  items: RowItem[];
}

export interface CatalogRowsResponse {
  billboard: Billboard | null;
  rows: CatalogRow[];
}

export interface GenreRef { slug: string; name: string }
export interface CastMember { name: string; character?: string; order?: number }

export interface EpisodeDetail {
  id: string;
  number: number;
  name: string;
  synopsis: string | null;
  stillUrl: string | null;
  durationSec: number | null;
  assetId: string | null;
  assetStatus: AssetStatus | null;
  progressPercent: number;
}

export interface SeasonDetail {
  id: string;
  number: number;
  name: string | null;
  episodes: EpisodeDetail[];
}

export interface TitleDetail {
  id: string;
  type: TitleType;
  name: string;
  synopsis: string | null;
  releaseYear: number | null;
  maturityRating: string | null;
  genres: GenreRef[];
  cast: CastMember[];
  directors: string[];
  backdropUrl: string | null;
  logoUrl: string | null;
  inMyList: boolean;
  seasons: SeasonDetail[];
  /** MOVIE only. */
  movieAssetId?: string;
  durationSec?: number;
  similar: Array<{ titleId: string; name: string; posterUrl: string | null }>;
}

export interface SearchResultItem {
  titleId: string;
  name: string;
  posterUrl: string | null;
  releaseYear: number | null;
  type: TitleType;
}

export const SEARCH_MIN_QUERY_LENGTH = 2;
/** Below this many FTS hits, top up with pg_trgm similarity (ADR-011). */
export const SEARCH_TRIGRAM_FALLBACK_THRESHOLD = 5;
export const SEARCH_TRIGRAM_MIN_SIMILARITY = 0.3;
