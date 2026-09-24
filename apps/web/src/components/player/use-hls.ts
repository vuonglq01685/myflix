"use client";

import { useEffect, useRef, useState } from "react";

/** hls.js tuning from HLD §7.1. */
export const HLS_CONFIG = {
  // Let the ABR estimator pick, starting from a deliberately pessimistic
  // bandwidth guess: the first frame appears almost immediately at a low
  // rendition and climbs over the next few seconds. That ramp is exactly what
  // "feels like Netflix" (NFR-01: first frame under 2s).
  startLevel: -1,
  abrEwmaDefaultEstimate: 500_000,
  maxBufferLength: 30,
  backBufferLength: 30,
  maxMaxBufferLength: 60,
  lowLatencyMode: false,
} as const;

export interface UseHlsResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
}

/**
 * Attaches an HLS source, preferring Safari's native support and falling back
 * to hls.js elsewhere (ADR-001). hls.js is imported dynamically so its ~200 KB
 * never lands in the Browse bundle.
 */
export function useHls(masterUrl: string | null): UseHlsResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !masterUrl) return;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = masterUrl;
      return;
    }

    let destroy = () => {};
    let cancelled = false;

    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setError("Trình duyệt không hỗ trợ Media Source Extensions");
        return;
      }

      const hls = new Hls({ ...HLS_CONFIG });
      hls.loadSource(masterUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError(data.details);
      });

      destroy = () => hls.destroy();
    });

    return () => {
      cancelled = true;
      destroy();
    };
  }, [masterUrl]);

  return { videoRef, error };
}
