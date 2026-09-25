import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageClient } from "@myflix/storage";

@Injectable()
export class StorageService extends StorageClient {
  constructor(config: ConfigService) {
    super({
      endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
      region: config.getOrThrow<string>("S3_REGION"),
      accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY"),
      secretAccessKey: config.getOrThrow<string>("S3_SECRET_KEY"),
      forcePathStyle: config.get<boolean>("S3_FORCE_PATH_STYLE", true),
      buckets: {
        source: config.getOrThrow<string>("BUCKET_SOURCE"),
        media: config.getOrThrow<string>("BUCKET_MEDIA"),
        images: config.getOrThrow<string>("BUCKET_IMAGES"),
        staging: config.getOrThrow<string>("BUCKET_STAGING"),
      },
    });
  }
}
