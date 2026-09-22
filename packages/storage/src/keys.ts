/**
 * Object key conventions (HLA §5).
 *
 * Keys never contain a film's name — only UUIDs. Renaming a title therefore
 * moves no bytes, and a leaked key list reveals nothing about the library.
 */
export const keys = {
  source: (assetId: string, extension: string) =>
    `${assetId}/original.${extension.replace(/^\./, '')}`,

  staging: (jobId: string, rest: string) => `${jobId}/${rest}`,

  master: (assetId: string) => `${assetId}/master.m3u8`,
  videoPlaylist: (assetId: string, rendition: string) => `${assetId}/v/${rendition}/playlist.m3u8`,
  audioPlaylist: (assetId: string) => `${assetId}/a/aac-128k/playlist.m3u8`,
  subtitlePlaylist: (assetId: string, lang: string) => `${assetId}/s/${lang}/playlist.m3u8`,
  previewClip: (assetId: string) => `${assetId}/preview.mp4`,
  sprite: (assetId: string, index = 0) => `${assetId}/sprite-${String(index).padStart(2, '0')}.jpg`,
  spriteVtt: (assetId: string) => `${assetId}/sprite.vtt`,
  assetPrefix: (assetId: string) => `${assetId}/`,

  poster: (titleId: string) => `${titleId}/poster.webp`,
  backdrop: (titleId: string) => `${titleId}/backdrop.webp`,
  logo: (titleId: string) => `${titleId}/logo.png`,
  still: (episodeId: string) => `${episodeId}/still.webp`,
} as const;

export interface BucketNames {
  source: string;
  media: string;
  images: string;
  staging: string;
}
