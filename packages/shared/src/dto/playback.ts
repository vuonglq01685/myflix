export interface PlaybackSessionRequest {
  assetId: string;
}

export interface PlaybackMarkers {
  introStartSec: number | null;
  introEndSec: number | null;
  creditsStartSec: number | null;
}

export interface NextEpisodeRef {
  assetId: string;
  titleId: string;
  name: string;
  episodeLabel: string;
  stillUrl: string | null;
}

export interface SubtitleRef {
  lang: string;
  label: string;
  isDefault: boolean;
}

export interface PlaybackSessionResponse {
  sessionId: string;
  assetId: string;
  masterUrl: string;
  expiresAt: string;
  durationSec: number;
  startPositionSec: number;
  spriteVttUrl: string | null;
  markers: PlaybackMarkers;
  nextEpisode: NextEpisodeRef | null;
  subtitles: SubtitleRef[];
}

export interface ProgressRequest {
  assetId: string;
  positionSec: number;
  durationSec: number;
}

/** At or above this fraction the asset counts as watched (BR / HLD §6.1). */
export const COMPLETION_RATIO = 0.95;
/** Below this many seconds it is a misclick, not a resume point. */
export const CONTINUE_WATCHING_MIN_SEC = 30;
export const PROGRESS_REPORT_INTERVAL_SEC = 10;

export interface QoeEventRequest {
  sessionId: string;
  startupTimeMs: number;
  rebufferCount: number;
  rebufferDurationMs: number;
  bitrateSwitches: number;
  avgBitrateKbps: number;
  watchedSec: number;
}
