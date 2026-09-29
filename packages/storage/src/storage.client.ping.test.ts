import { test } from "node:test";
import assert from "node:assert/strict";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { StorageClient } from "./storage.client";

interface SendOptions {
  abortSignal?: AbortSignal;
}

function newTestClient(): StorageClient {
  return new StorageClient({
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
}

/** Monkey-patches S3Client.send to record both the command and the second
 *  (options) argument, so tests can assert on abortSignal pass-through. */
function patchSend(sent: [unknown, SendOptions | undefined][]): () => void {
  const originalSend = S3Client.prototype.send;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (S3Client.prototype as any).send = async function (
    command: unknown,
    options?: SendOptions,
  ) {
    sent.push([command, options]);
    return {};
  };
  return () => {
    S3Client.prototype.send = originalSend;
  };
}

test("ping() sends a HeadBucketCommand against the source bucket", async () => {
  const sent: [unknown, SendOptions | undefined][] = [];
  const restoreSend = patchSend(sent);

  try {
    const client = newTestClient();

    await client.ping();

    assert.equal(sent.length, 1);
    assert.ok(sent[0]![0] instanceof HeadBucketCommand);
    assert.equal(
      (sent[0]![0] as HeadBucketCommand).input.Bucket,
      "myflix-source",
    );
    assert.equal(sent[0]![1]?.abortSignal, undefined);
  } finally {
    restoreSend();
  }
});

// A5 r1 — ping() truyền AbortSignal xuống send() để health check huỷ HeadBucket khi quá hạn
test("ping(signal) passes the AbortSignal through to send", async () => {
  const sent: [unknown, SendOptions | undefined][] = [];
  const restoreSend = patchSend(sent);

  try {
    const client = newTestClient();
    const controller = new AbortController();

    await client.ping(controller.signal);

    assert.equal(sent.length, 1);
    assert.equal(sent[0]![1]?.abortSignal, controller.signal);
  } finally {
    restoreSend();
  }
});
