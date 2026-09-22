/** Parsed season/episode numbers from a source file name (F-023 bulk create). */
export interface EpisodeRef {
  season: number;
  episode: number;
}

const PATTERNS: readonly RegExp[] = [
  /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i,          // S01E03, s01.e03, S1-E3
  /\b(\d{1,2})x(\d{1,3})\b/i,                    // 1x03
  /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i,
];

/** Returns null when nothing matches — the admin then fills it in by hand
 *  rather than the importer guessing wrong. */
export function parseEpisodeFilename(fileName: string): EpisodeRef | null {
  for (const pattern of PATTERNS) {
    const m = pattern.exec(fileName);
    if (!m) continue;
    const season = Number(m[1]);
    const episode = Number(m[2]);
    if (season > 0 && episode > 0) return { season, episode };
  }
  return null;
}
