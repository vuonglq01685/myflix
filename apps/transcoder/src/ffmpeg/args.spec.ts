import {
  buildLadderArgs,
  buildPreviewArgs,
  buildSpriteVtt,
  spriteGrid,
  variantStreamMap,
} from "./args";
import { buildLadder } from "@myflix/shared";

const probe = {
  width: 1920,
  height: 1080,
  frameRate: 23.976,
  durationSec: 7200,
  videoCodec: "h264",
  audioCodec: "aac",
};

const args = () =>
  buildLadderArgs({ sourcePath: "/in.mkv", outputDir: "/out", probe });

describe("buildLadderArgs", () => {
  it("decodes once on the GPU and keeps frames in VRAM", () => {
    const a = args();
    expect(a).toContain("-hwaccel_output_format");
    expect(a[a.indexOf("-hwaccel_output_format") + 1]).toBe("cuda");
    expect(a.filter((x) => x === "-i")).toHaveLength(1);
  });

  it("AC-010-3: pins keyframes so renditions stay aligned", () => {
    const a = args();
    // 23.976 fps x 4s segments -> GOP 96.
    expect(a[a.indexOf("-g") + 1]).toBe("96");
    expect(a[a.indexOf("-keyint_min") + 1]).toBe("96");
    expect(a[a.indexOf("-sc_threshold") + 1]).toBe("0");
    expect(a[a.indexOf("-forced-idr") + 1]).toBe("1");
  });

  it("packages fMP4/CMAF with 4 second segments (ADR-010)", () => {
    const a = args();
    expect(a[a.indexOf("-hls_segment_type") + 1]).toBe("fmp4");
    expect(a[a.indexOf("-hls_time") + 1]).toBe("4");
    expect(a[a.indexOf("-hls_playlist_type") + 1]).toBe("vod");
  });

  it("emits one video map, one audio map and one variant per rung", () => {
    const rungs = buildLadder(probe);
    const a = args();
    expect(a.filter((x) => x === "-map")).toHaveLength(rungs.length * 2);
    expect(variantStreamMap(rungs)).toBe(
      "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p v:3,a:3,name:360p",
    );
  });

  it("shortens the ladder for a 720p source rather than upscaling", () => {
    const a = buildLadderArgs({
      sourcePath: "/in.mkv",
      outputDir: "/out",
      probe: { ...probe, width: 1280, height: 720 },
    });
    const map = a[a.indexOf("-var_stream_map") + 1]!;
    expect(map).toBe("v:0,a:0,name:720p v:1,a:1,name:480p v:2,a:2,name:360p");
    expect(map).not.toContain("1080p");
  });

  it("omits -hwaccel and uses a CPU scale filter for a non-NVENC encoder", () => {
    const a = buildLadderArgs({
      sourcePath: "/in.mkv",
      outputDir: "/out",
      probe,
      encoder: "libx264",
    });
    expect(a).not.toContain("-hwaccel");
    expect(a.join(" ")).not.toContain("scale_cuda");
  });

  it("still emits -hwaccel cuda for the default h264_nvenc encoder", () => {
    const a = args();
    expect(a).toContain("-hwaccel");
  });

  it("AC21: caps the ladder to 720p/480p for a non-NVENC encoder on a 1080p source", () => {
    // Proves the limitTo wiring actually reaches buildLadderArgs's real output,
    // not just buildLadder's own unit test above.
    const a = buildLadderArgs({
      sourcePath: "/in.mkv",
      outputDir: "/out",
      probe,
      encoder: "libx264",
    });
    const map = a[a.indexOf("-var_stream_map") + 1]!;
    expect(map).toBe("v:0,a:0,name:720p v:1,a:1,name:480p");
  });

  it("omits NVENC-only rate-control flags and uses the libx264 preset for a non-NVENC encoder", () => {
    const a = buildLadderArgs({
      sourcePath: "/in.mkv",
      outputDir: "/out",
      probe,
      encoder: "libx264",
    });
    expect(a).not.toContain("-rc");
    expect(a).not.toContain("-cq:v:0");
    expect(a).not.toContain("-forced-idr");
    expect(a[a.indexOf("-preset") + 1]).toBe("veryfast");
    expect(a).toContain("-g");
    expect(a).toContain("-keyint_min");
    expect(a).toContain("-sc_threshold");
  });

  it("still emits -rc vbr, -cq:v and -forced-idr with the p5 preset for the default h264_nvenc encoder", () => {
    const a = args();
    expect(a[a.indexOf("-rc") + 1]).toBe("vbr");
    expect(a).toContain("-cq:v:0");
    expect(a[a.indexOf("-preset") + 1]).toBe("p5");
    expect(a[a.indexOf("-forced-idr") + 1]).toBe("1");
  });
});

describe("buildPreviewArgs", () => {
  it("seeks before -i, drops audio and front-loads the moov atom", () => {
    const a = buildPreviewArgs({
      sourcePath: "/in.mkv",
      outputPath: "/out.mp4",
      durationSec: 7200,
    });
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
    expect(a[a.indexOf("-ss") + 1]).toBe("1440"); // 20% of 7200s
    expect(a[a.indexOf("-t") + 1]).toBe("25");
    expect(a).toContain("-an");
    expect(a[a.indexOf("-movflags") + 1]).toBe("+faststart");
  });

  it("drops -hwaccel and uses plain scale for libx264", () => {
    const a = buildPreviewArgs({
      sourcePath: "/in.mkv",
      outputPath: "/out.mp4",
      durationSec: 7200,
      encoder: "libx264",
    });
    expect(a).not.toContain("-hwaccel");
    expect(a[a.indexOf("-vf") + 1]).toBe("scale=854:480");
    expect(a[a.indexOf("-preset") + 1]).toBe("veryfast");
  });

  it("still emits the p4 preset for the default h264_nvenc encoder", () => {
    const a = buildPreviewArgs({
      sourcePath: "/in.mkv",
      outputPath: "/out.mp4",
      durationSec: 7200,
    });
    expect(a[a.indexOf("-preset") + 1]).toBe("p4");
  });
});

describe("sprite sheet", () => {
  it("lays a 2 hour film out on a near-square grid", () => {
    expect(spriteGrid(7200)).toEqual({ cols: 27, rows: 27, count: 720 });
  });

  it("maps each cue to the right tile offset", () => {
    // 90s at one frame per 10s = 9 tiles, laid out 3 wide.
    const vtt = buildSpriteVtt({
      durationSec: 90,
      spriteFileName: () => "sprite-00.jpg",
    });
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:10.000");
    expect(vtt).toContain("sprite-00.jpg#xywh=0,0,160,90");
    expect(vtt).toContain("sprite-00.jpg#xywh=160,0,160,90");
    expect(vtt).toContain("sprite-00.jpg#xywh=320,0,160,90");
    // Fourth tile wraps onto the second row.
    expect(vtt).toContain("sprite-00.jpg#xywh=0,90,160,90");
  });
});
