"use client";

import { useEffect, useRef, useState } from "react";
import type { Billboard as BillboardData } from "@myflix/shared";

const TRAILER_DELAY_MS = 2000;

/**
 * Four stacked layers (doc 10 §6.1). Both gradients matter: the horizontal
 * one makes the copy legible, the vertical one dissolves the billboard into
 * the first row. Drop the vertical one and a hard seam appears across the
 * page — the single most amateur-looking detail available here.
 */
export function Billboard({ billboard }: { billboard: BillboardData }) {
  const [showTrailer, setShowTrailer] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!billboard.trailerPreviewUrl) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = setTimeout(() => setShowTrailer(true), TRAILER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [billboard.trailerPreviewUrl]);

  return (
    <section
      aria-labelledby="billboard-heading"
      className="relative w-full"
      style={{
        height: "var(--size-billboard)",
        minHeight: "var(--size-billboard-min)",
      }}
    >
      {/* Layer 1 — artwork, swapped for the muted trailer after 2s. */}
      <img
        src={billboard.backdropUrl}
        alt=""
        width={1920}
        height={1080}
        fetchPriority="high"
        className="absolute inset-0 size-full object-cover"
        style={{
          opacity: showTrailer ? 0 : 1,
          transition: "opacity var(--duration-slow) var(--ease-standard)",
        }}
      />
      {billboard.trailerPreviewUrl && showTrailer ? (
        <video
          ref={videoRef}
          src={billboard.trailerPreviewUrl}
          autoPlay
          muted
          playsInline
          loop
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}

      {/* Layer 2 — horizontal scrim for text contrast. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to right, rgb(0 0 0 / 0.85) 0%, rgb(0 0 0 / 0.5) 35%, transparent 65%)",
        }}
      />
      {/* Layer 3 — vertical scrim blending into the rows below. */}
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(to top, #141414 0%, transparent 30%)",
        }}
      />

      {/* Layer 4 — content. */}
      <div className="absolute bottom-[18%] page-x max-w-xl">
        {billboard.logoUrl ? (
          <img
            src={billboard.logoUrl}
            alt={billboard.name}
            className="mb-4 max-h-32 w-auto origin-bottom-left"
            style={{
              transform: showTrailer ? "scale(0.7) translateY(2rem)" : "none",
              transition: "transform var(--duration-slow) var(--ease-standard)",
            }}
          />
        ) : (
          <h1
            id="billboard-heading"
            className="mb-4 font-bold"
            style={{
              fontSize: "var(--text-billboard)",
              letterSpacing: "-0.02em",
            }}
          >
            {billboard.name}
          </h1>
        )}

        <p
          className="mb-5 line-clamp-3"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {billboard.synopsis}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            className="rounded px-6 py-2 font-medium text-black transition-opacity hover:opacity-80"
            style={{ backgroundColor: "var(--color-text-primary)" }}
          >
            ▶ Phát
          </button>
          <button
            type="button"
            className="rounded px-6 py-2 font-medium transition-colors"
            style={{ backgroundColor: "var(--color-bg-elevated)" }}
          >
            ⓘ Thông tin
          </button>
        </div>
      </div>
    </section>
  );
}
