import type { RowType } from "@myflix/shared";

/**
 * Browse rows are rule-based, not ML (charter: recommendation engine is out
 * of scope). Each definition owns its own cache policy because personalised
 * rows must never be shared between profiles.
 */
export interface RowDefinition {
  id: string;
  title: string;
  type: RowType;
  /** null = never cache. */
  cacheTtlSec: number | null;
}

export const ROW_DEFINITIONS: readonly RowDefinition[] = [
  {
    id: "continue-watching",
    title: "Tiếp tục xem",
    type: "CONTINUE",
    cacheTtlSec: null,
  },
  {
    id: "my-list",
    title: "Danh sách của tôi",
    type: "MY_LIST",
    cacheTtlSec: null,
  },
  {
    id: "recently-added",
    title: "Mới thêm gần đây",
    type: "RECENT",
    cacheTtlSec: 60,
  },
  {
    id: "rewatch",
    title: "Xem lại lần nữa",
    type: "REWATCH",
    cacheTtlSec: null,
  },
] as const;

export const CACHE_KEYS = {
  globalRows: (genreId = "all") => `rows:global:${genreId}`,
  titleDetail: (titleId: string) => `title:${titleId}`,
  search: (normalizedQuery: string) => `search:${normalizedQuery}`,
} as const;

export const CACHE_TTL = {
  globalRows: 60,
  titleDetail: 300,
  search: 120,
} as const;
