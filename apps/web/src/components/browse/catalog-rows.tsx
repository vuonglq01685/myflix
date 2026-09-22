import type { CatalogRow } from '@myflix/shared';
import { TitleCard } from './title-card';

export function CatalogRows({ rows }: { rows: CatalogRow[] }) {
  return (
    <div
      className="relative z-10 -mt-24 flex flex-col"
      style={{ gap: 'var(--space-row-gap)' }}
    >
      {rows.map((row) => (
        <section key={row.id} aria-labelledby={`row-${row.id}`}>
          <h2
            id={`row-${row.id}`}
            className="page-x mb-2 font-medium"
            style={{ fontSize: 'var(--text-row-title)' }}
          >
            {row.title}
          </h2>

          <ul
            className="row-scroller flex overflow-x-auto page-x"
            style={{ gap: 'var(--space-card-gap)' }}
          >
            {row.items.map((item) => (
              <TitleCard key={`${row.id}-${item.titleId}`} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
