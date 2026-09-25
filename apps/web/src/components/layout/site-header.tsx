"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const NAV = [
  { href: "/browse", label: "Trang chủ" },
  { href: "/genre/movie", label: "Phim" },
  { href: "/genre/series", label: "Series" },
  { href: "/my-list", label: "Danh sách của tôi" },
];

/**
 * Transparent at the top of the page, solid once scrolled (doc 10 §5). Small
 * detail, high recognition — a header that is opaque from the first pixel is
 * the clearest tell of a careless clone.
 */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 flex items-center gap-8 page-x transition-colors"
      style={{
        height: "var(--size-header)",
        backgroundColor: scrolled ? "var(--color-bg-page)" : "transparent",
        transitionDuration: "var(--duration-base)",
        transitionTimingFunction: "var(--ease-standard)",
      }}
    >
      <Link
        href="/browse"
        className="text-2xl font-bold tracking-tight"
        style={{ color: "var(--color-brand)" }}
      >
        MYFLIX
      </Link>

      <nav aria-label="Điều hướng chính" className="hidden md:block">
        <ul className="flex gap-5 text-sm">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="transition-colors hover:text-white"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-4">
        <Link href="/search" aria-label="Tìm kiếm" className="text-sm">
          Tìm kiếm
        </Link>
        {/* TODO(phase-4): profile avatar + dropdown. */}
      </div>
    </header>
  );
}
