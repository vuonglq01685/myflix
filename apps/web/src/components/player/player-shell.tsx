"use client";

import { useEffect, useState } from "react";
import type { PlaybackSessionResponse } from "@myflix/shared";
import { apiFetch } from "@/lib/api-client";
import { useHls } from "./use-hls";

export function PlayerShell({ assetId }: { assetId: string }) {
  const [session, setSession] = useState<PlaybackSessionResponse | null>(null);
  const { videoRef, error } = useHls(session?.masterUrl ?? null);

  useEffect(() => {
    void apiFetch<PlaybackSessionResponse>("/playback/session", {
      method: "POST",
      body: JSON.stringify({ assetId }),
    }).then(setSession);
  }, [assetId]);

  // TODO(phase-4/5):
  //  - resume from session.startPositionSec
  //  - POST /playback/progress every 10s; sendBeacon on visibilitychange
  //  - renew the signed URL once under 30 minutes remain, swapping the query
  //    string through hls.js's xhrSetup rather than reloading the player
  //  - Skip Intro / Next Episode driven by session.markers
  //  - sprite scrub preview from session.spriteVttUrl
  //  - keyboard map: space/k, arrows, m, f, c, esc

  return (
    <div className="fixed inset-0 bg-black">
      <video
        ref={videoRef}
        className="size-full"
        controls
        autoPlay
        playsInline
      />
      {error ? (
        <p role="alert" className="absolute inset-x-0 bottom-8 text-center">
          Không phát được: {error}
        </p>
      ) : null}
    </div>
  );
}
