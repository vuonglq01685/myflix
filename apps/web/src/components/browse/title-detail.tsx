import { apiFetch } from "@/lib/api-client";
import type { TitleDetail as TitleDetailData } from "@myflix/shared";

/** Shared body for both the intercepted modal and the standalone page. */
export async function TitleDetail({ titleId }: { titleId: string }) {
  const title = await apiFetch<TitleDetailData>(`/catalog/titles/${titleId}`);

  return (
    <article className="page-x pt-[calc(var(--size-header)+2rem)]">
      <h1 className="text-3xl font-bold">{title.name}</h1>
      <p
        className="mt-3 max-w-2xl"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {title.synopsis}
      </p>
      {/* TODO(phase-4): season picker, episode list, cast, similar titles. */}
    </article>
  );
}
