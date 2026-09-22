import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signMediaPath, type SignedMediaUrl } from '@myflix/shared';

/**
 * Issues the signed media URLs nginx validates (ADR-006). After this point
 * the API is off the data path entirely — video bytes never touch Node.
 */
@Injectable()
export class MediaUrlService {
  constructor(private readonly config: ConfigService) {}

  sign(assetId: string, path: string): SignedMediaUrl {
    return signMediaPath({
      secret: this.config.getOrThrow<string>('MEDIA_SIGNING_SECRET'),
      assetId,
      path,
      ttlSec: this.config.getOrThrow<number>('MEDIA_URL_TTL_SEC'),
    });
  }
}
