"use client";

import Link from "next/link";
import type { RowItem } from "@myflix/shared";

/**
 * TODO(phase-4): the expanded hover card renders through a portal positioned
 * from getBoundingClientRect(), not as a child of the card — the row is an
 * overflow-x container and would clip it (risk R-4). Open after 400ms, close
 * after 180ms.
 */
export function TitleCard({ item }: { item: RowItem }) {
  return (
    <li className="w-[19%] shrink-0 min-w-[160px]">
      <Link
        href={`/title/${item.titleId}`}
        className="group block"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <div
          className="relative overflow-hidden"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            width={640}
            height={360}
            loading="lazy"
            className="aspect-video w-full object-cover transition-transform"
            style={{
              transitionDuration: "var(--duration-base)",
              transitionTimingFunction: "var(--ease-standard)",
            }}
          />

          {typeof item.progressPercent === "number" ? (
            <div
              className="absolute inset-x-2 bottom-2 h-[3px]"
              style={{ backgroundColor: "var(--color-border-subtle)" }}
            >
              <div
                className="h-full"
                style={{
                  width: `${item.progressPercent}%`,
                  backgroundColor: "var(--color-brand)",
                }}
              />
            </div>
          ) : null}
        </div>

        <p
          className="mt-1 truncate font-medium"
          style={{
            fontSize: "var(--text-card-title)",
            color: "var(--color-text-secondary)",
          }}
        >
          {item.episodeLabel
            ? `${item.name} · ${item.episodeLabel}`
            : item.name}
        </p>
      </Link>
    </li>
  );
}
