import { test } from "node:test";
import assert from "node:assert/strict";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { StorageClient } from "./storage.client";

test("ping() sends a HeadBucketCommand against the source bucket", async () => {
  const sent: unknown[] = [];
  const originalSend = S3Client.prototype.send;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (S3Client.prototype as any).send = async function (command: unknown) {
    sent.push(command);
    return {};
  };

  try {
    const client = new StorageClient({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      accessKeyId: "x",
      secretAccessKey: "x",
      buckets: {
        source: "myflix-source",
        media: "myflix-media",
        images: "myflix-images",
        staging: "myflix-staging",
      },
    });

    await client.ping();

    assert.equal(sent.length, 1);
    assert.ok(sent[0] instanceof HeadBucketCommand);
    assert.equal((sent[0] as HeadBucketCommand).input.Bucket, "myflix-source");
  } finally {
    S3Client.prototype.send = originalSend;
  }
});
