import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageClient } from '@myflix/storage';

/** Nest-flavoured construction of the shared StorageClient. No S3 logic here
 *  — it lives in @myflix/storage so the worker uses exactly the same code. */
@Injectable()
export class StorageService extends StorageClient {
  constructor(config: ConfigService) {
    super({
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      region: config.getOrThrow<string>('S3_REGION'),
      accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      forcePathStyle: config.get<boolean>('S3_FORCE_PATH_STYLE', true),
      presignTtlSec: config.get<number>('UPLOAD_URL_TTL_SEC', 3600),
      buckets: {
        source: config.getOrThrow<string>('BUCKET_SOURCE'),
        media: config.getOrThrow<string>('BUCKET_MEDIA'),
        images: config.getOrThrow<string>('BUCKET_IMAGES'),
        staging: config.getOrThrow<string>('BUCKET_STAGING'),
      },
    });
  }
}
