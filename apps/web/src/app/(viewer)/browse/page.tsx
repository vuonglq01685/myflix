import { Billboard } from '@/components/browse/billboard';
import { CatalogRows } from '@/components/browse/catalog-rows';
import { apiFetch } from '@/lib/api-client';
import type { CatalogRowsResponse } from '@myflix/shared';

export const dynamic = 'force-dynamic';

export default async function BrowsePage() {
  // SSR the first paint so the billboard and the first row arrive with the
  // HTML; the rest hydrate in behind an IntersectionObserver.
  const data = await apiFetch<CatalogRowsResponse>('/catalog/rows');

  return (
    <>
      {data.billboard ? <Billboard billboard={data.billboard} /> : null}
      <CatalogRows rows={data.rows} />
    </>
  );
}
