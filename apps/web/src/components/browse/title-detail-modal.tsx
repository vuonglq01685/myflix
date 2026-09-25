"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Dialog wrapper for the intercepted route. Back or Escape closes it and
 * returns to the Browse page with its scroll position intact.
 */
export function TitleDetailModal({ titleId }: { titleId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      onClose={() => router.back()}
      aria-label="Chi tiết nội dung"
      className="m-auto w-[min(900px,90vw)] p-0 backdrop:bg-[var(--color-overlay-scrim)]"
      style={{
        backgroundColor: "var(--color-bg-card)",
        color: "var(--color-text-primary)",
        borderRadius: "var(--radius-modal)",
      }}
    >
      {/* TODO(phase-4): reuse the TitleDetail body here once it is a client
          component or fetched through a route handler. */}
      <div className="p-8">Chi tiết: {titleId}</div>
    </dialog>
  );
}
