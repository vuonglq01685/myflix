import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildLadder } from "./ladder";
import { gopForFrameRate, parseFrameRate } from "./gop";
import {
  mediaSignature,
  signMediaPath,
  verifyMediaSignature,
} from "./signed-url";
import { parseProgressChunk, computePercent } from "./progress";
import { parseEpisodeFilename } from "./episode-filename";

// ── BR-024: the ladder never upscales ───────────────────────────────────────
test("BR-024 ladder is truncated at the source resolution", () => {
  const names = (w: number, h: number) =>
    buildLadder({ width: w, height: h }).map((r) => r.name);

  assert.deepEqual(names(3840, 2160), ["1080p", "720p", "480p", "360p"]); // 4K capped at 1080p
  assert.deepEqual(names(1920, 1080), ["1080p", "720p", "480p", "360p"]);
  assert.deepEqual(names(1280, 720), ["720p", "480p", "360p"]);
  assert.deepEqual(names(854, 480), ["480p", "360p"]);
  assert.deepEqual(names(640, 360), ["360p"]);
  assert.deepEqual(names(320, 240), ["360p"]); // below the floor: one rung, not zero
});

test("2.39:1 source keeps its aspect ratio (no letterbox)", () => {
  const top = buildLadder({ width: 2048, height: 858 })[0]!;
  assert.equal(top.height, 1080);
  assert.equal(top.width, 1920);
});

test("portrait source swaps the constrained axis and stays even", () => {
  const rungs = buildLadder({ width: 1080, height: 1920 });
  assert.deepEqual(
    rungs.map((r) => r.name),
    ["1080p", "720p", "480p", "360p"],
  );
  for (const r of rungs) {
    assert.equal(r.height % 2, 0, `${r.name} height must be even for H.264`);
    assert.ok(r.height > r.width, `${r.name} should stay portrait`);
  }
});

test("AC21 CPU branch caps the ladder to exactly 720p and 480p", () => {
  const names = buildLadder(
    { width: 1920, height: 1080 },
    { limitTo: ["720p", "480p"] },
  ).map((r) => r.name);
  assert.deepStrictEqual(names, ["720p", "480p"]);
});

// ── Keyframe alignment ──────────────────────────────────────────────────────
test("GOP equals frame rate x 4 for every reference rate", () => {
  assert.equal(gopForFrameRate(23.976), 96);
  assert.equal(gopForFrameRate(24), 96);
  assert.equal(gopForFrameRate(25), 100);
  assert.equal(gopForFrameRate(29.97), 120);
  assert.equal(gopForFrameRate(30), 120);
  assert.equal(gopForFrameRate(50), 200);
  assert.equal(gopForFrameRate(59.94), 240);
  assert.equal(gopForFrameRate(60), 240);
});

test("ffprobe rational frame rates parse", () => {
  assert.ok(Math.abs(parseFrameRate("24000/1001") - 23.976) < 0.001);
  assert.equal(parseFrameRate("25/1"), 25);
  assert.throws(() => parseFrameRate("24/0"));
  assert.throws(() => gopForFrameRate(0));
});

// ── Signed URLs ─────────────────────────────────────────────────────────────
const SECRET = "test-secret";
const ASSET = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

test("signature matches nginx secure_link_md5 byte for byte", () => {
  const expires = 1789012345;
  // Reference value produced by the same expression nginx evaluates.
  const reference = execFileSync("/bin/sh", [
    "-c",
    `printf '%s' '${SECRET}${ASSET}${expires}' | openssl md5 -binary | openssl base64 | tr '+/' '-_' | tr -d '=\n'`,
  ])
    .toString()
    .trim();
  assert.equal(mediaSignature(SECRET, ASSET, expires), reference);
});

test("signed URL verifies, expires, and rejects tampering", () => {
  const now = new Date("2026-09-08T10:00:00Z");
  const { url, expiresAt } = signMediaPath({
    secret: SECRET,
    assetId: ASSET,
    path: "master.m3u8",
    now,
  });

  const qs = new URLSearchParams(url.slice(url.indexOf("?") + 1));
  const md5 = qs.get("md5")!;
  const expires = qs.get("expires")!;

  const check = (over: Partial<Parameters<typeof verifyMediaSignature>[0]>) =>
    verifyMediaSignature({
      secret: SECRET,
      assetId: ASSET,
      md5,
      expires,
      now,
      ...over,
    });

  assert.equal(check({}), "ok");
  assert.equal(check({ now: new Date(expiresAt.getTime() + 1000) }), "expired");
  assert.equal(check({ md5: md5.slice(0, -1) + "x" }), "invalid");
  assert.equal(
    check({ assetId: "00000000-0000-0000-0000-000000000000" }),
    "invalid",
  );
  assert.equal(check({ md5: undefined }), "invalid");
  assert.equal(check({ expires: undefined }), "invalid");
  assert.equal(check({ expires: "not-a-number" }), "invalid");
});

// ── FFmpeg progress ─────────────────────────────────────────────────────────
test("progress chunk parses and percent stays inside the CHECK range", () => {
  const chunk = [
    "frame=12480",
    "fps=287.4",
    "bitrate=5012.3kbits/s",
    "total_size=78643200",
    "out_time_us=41400000",
    "out_time_ms=41400000",
    "out_time=00:00:41.400000",
    "speed=8.62x",
    "progress=continue",
  ].join("\n");

  const p = parseProgressChunk(chunk)!;
  assert.equal(p.outTimeUs, 41_400_000);
  assert.equal(p.speed, 8.62);
  assert.equal(p.done, false);

  assert.equal(computePercent(p.outTimeUs, 414), 10);
  assert.equal(computePercent(0, 414), 0);
  assert.equal(computePercent(undefined, 414), 0);
  assert.equal(computePercent(999_000_000, 414), 100); // duration lied; clamp
  assert.equal(parseProgressChunk("frame=1\nfps=2"), null); // partial chunk
  assert.equal(parseProgressChunk("progress=end")!.done, true);
});

// ── Episode filename parsing ────────────────────────────────────────────────
test("episode references parse from the common filename shapes", () => {
  assert.deepEqual(parseEpisodeFilename("Ironwood.S01E03.1080p.mkv"), {
    season: 1,
    episode: 3,
  });
  assert.deepEqual(parseEpisodeFilename("ironwood s01e03.mkv"), {
    season: 1,
    episode: 3,
  });
  assert.deepEqual(parseEpisodeFilename("Ironwood 1x03.mkv"), {
    season: 1,
    episode: 3,
  });
  assert.deepEqual(parseEpisodeFilename("Ironwood Season 1 Episode 3.mkv"), {
    season: 1,
    episode: 3,
  });
  assert.equal(parseEpisodeFilename("Neon Harbor (2024).mkv"), null);
  assert.equal(parseEpisodeFilename("S00E00.mkv"), null);
});
