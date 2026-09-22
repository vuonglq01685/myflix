import type { JobStatus, TitleStatus, TitleType } from '../enums';

export interface AdminStats {
  titles: { total: number; published: number; draft: number };
  assets: { ready: number; processing: number; failed: number };
  queue: { waiting: number; active: number };
  storage: { sourceGb: number; mediaGb: number; imagesGb: number };
  transcode: {
    avgSpeedMultiplier: number;
    avgDurationMinutes: number;
    successRatePercent: number;
  };
}

export interface CreateTitleRequest {
  type: TitleType;
  name: string;
  originalName?: string;
  synopsis?: string;
  releaseYear?: number;
  maturityRating?: string;
  genreSlugs?: string[];
}

export interface AdminTitleListItem {
  id: string;
  name: string;
  type: TitleType;
  status: TitleStatus;
  assetsReady: number;
  assetsTotal: number;
  updatedAt: string;
}

export interface JobListItem {
  id: string;
  assetId: string;
  status: JobStatus;
  stage: string | null;
  percent: number;
  encoder: string | null;
  avgSpeed: number | null;
  queuedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface UploadSubtitleRequest {
  lang: string;
  label: string;
  kind?: 'SUBTITLES' | 'CAPTIONS' | 'FORCED';
  isDefault?: boolean;
}
