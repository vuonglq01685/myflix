import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import type { CompletedPart, PartUrl } from "@myflix/shared";
import type { BucketNames } from "./keys";

export interface StorageOptions {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  buckets: BucketNames;
  presignTtlSec?: number;
}

/**
 * S3 wrapper shared by the API and the worker (ADR-002/ADR-003). MinIO now,
 * S3 or R2 later — only `endpoint` changes, so nothing outside this file may
 * mention MinIO by name.
 */
export class StorageClient {
  readonly buckets: BucketNames;
  private readonly s3: S3Client;
  private readonly presignTtlSec: number;

  constructor(options: StorageOptions) {
    this.buckets = options.buckets;
    this.presignTtlSec = options.presignTtlSec ?? 3600;
    this.s3 = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  // ── Multipart upload (browser -> storage, never through Node) ─────────────

  async createMultipartUpload(
    bucket: string,
    key: string,
    contentType: string,
  ): Promise<string> {
    const out = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!out.UploadId)
      throw new Error(`no uploadId returned for ${bucket}/${key}`);
    return out.UploadId;
  }

  presignParts(params: {
    bucket: string;
    key: string;
    uploadId: string;
    from: number;
    to: number;
  }): Promise<PartUrl[]> {
    const numbers = Array.from(
      { length: params.to - params.from + 1 },
      (_, i) => params.from + i,
    );
    return Promise.all(
      numbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.s3,
          new UploadPartCommand({
            Bucket: params.bucket,
            Key: params.key,
            UploadId: params.uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: this.presignTtlSec },
        ),
      })),
    );
  }

  /** Server-side truth for resuming an interrupted upload. */
  async listUploadedParts(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<number[]> {
    const out = await this.s3.send(
      new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
    );
    return (out.Parts ?? [])
      .map((p) => p.PartNumber)
      .filter((n): n is number => n !== undefined);
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: CompletedPart[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({ PartNumber: p.partNumber, ETag: p.eTag })),
        },
      }),
    );
  }

  abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<unknown> {
    return this.s3.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  // ── Plain object operations ───────────────────────────────────────────────

  async getStream(bucket: string, key: string): Promise<Readable> {
    const out = await this.s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return out.Body as Readable;
  }

  putObject(
    bucket: string,
    key: string,
    body: Buffer | Readable,
    contentType?: string,
  ) {
    return this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async listKeys(bucket: string, prefix: string): Promise<string[]> {
    const found: string[] = [];
    let token: string | undefined;
    do {
      const out = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of out.Contents ?? []) if (item.Key) found.push(item.Key);
      token = out.NextContinuationToken;
    } while (token);
    return found;
  }

  /**
   * Promote a finished job from staging to the serving bucket. Artifacts are
   * only ever copied once every step succeeded, so myflix-media can never
   * contain a half-written asset (HLD §5.2).
   */
  async commitPrefix(params: {
    fromBucket: string;
    fromPrefix: string;
    toBucket: string;
    toPrefix: string;
  }): Promise<number> {
    const sourceKeys = await this.listKeys(
      params.fromBucket,
      params.fromPrefix,
    );
    for (const key of sourceKeys) {
      const suffix = key.slice(params.fromPrefix.length);
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: params.toBucket,
          Key: `${params.toPrefix}${suffix}`,
          CopySource: `/${params.fromBucket}/${encodeURIComponent(key)}`,
        }),
      );
    }
    return sourceKeys.length;
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    // DeleteObjects accepts at most 1000 keys per call.
    for (let i = 0; i < keys.length; i += 1000) {
      await this.s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) },
        }),
      );
    }
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    const keys = await this.listKeys(bucket, prefix);
    if (keys.length) await this.deleteObjects(bucket, keys);
    return keys.length;
  }

  /** Health check probe: confirms the source bucket is reachable (design §3.2). */
  async ping(signal?: AbortSignal): Promise<void> {
    await this.s3.send(
      new HeadBucketCommand({ Bucket: this.buckets.source }),
      { abortSignal: signal }, // A5 r1 — huỷ request thua withTimeout, không giữ socket của pool 50
    );
  }
}
