import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import type Redis from "ioredis";
import { Public } from "../common/decorators";
import { PrismaService } from "../prisma/prisma.service";
import { REDIS } from "../redis/redis.module";
import { StorageService } from "../storage/storage.service";

const CHECK_TIMEOUT_MS = 1_000; // mission D8
// mission D7 — chỉ nội bộ mạng compose, không có env key mới cho `api`
const TRANSCODER_GPU_URL = "http://transcoder:4100/health/gpu";

type CheckState = "ok" | "fail";
type GpuState = "ok" | "not_required" | "down" | "unreachable"; // mission D7 / US2 Q4, Q11

/** Docker healthcheck target. 503 when postgres/redis/minio fail or gpu is down/unreachable (API spec §12, mission D7). */
@Controller("health")
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [postgres, redis, minio, gpu] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(() => this.redis.ping()),
      probe(() => this.storage.ping()),
      probeGpu(),
    ]);

    const checks = { postgres, redis, minio, gpu };
    const healthy =
      checks.postgres === "ok" &&
      checks.redis === "ok" &&
      checks.minio === "ok" &&
      (checks.gpu === "ok" || checks.gpu === "not_required");

    if (!healthy) res.status(503);
    return {
      status: healthy ? "ok" : "degraded",
      checks,
      version: process.env.npm_package_version ?? "1.0.0",
    };
  }
}

async function probeGpu(): Promise<GpuState> {
  try {
    // Cả fetch() lẫn res.json() chạy bên trong withTimeout(), nên body treo
    // sau khi header đã về cũng bị tính vào CHECK_TIMEOUT_MS (S5).
    return await withTimeout(async () => {
      // mission D8 — huỷ request thua withTimeout, không để socket treo tới timeout mặc định của undici
      const res = await fetch(TRANSCODER_GPU_URL, {
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (res.status === 503) return "down";
      const body: unknown = await res.json();
      const gpu = (body as { gpu?: unknown } | null)?.gpu;
      return gpu === "ok" || gpu === "not_required" ? gpu : "unreachable";
    });
  } catch {
    return "unreachable"; // từ chối kết nối HOẶC quá 1.000 ms — A6, Q11
  }
}

function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
  let timer!: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("check timeout")),
      CHECK_TIMEOUT_MS,
    );
  });
  // .finally clear timer dù thắng hay thua race — timer không rò mỗi lần gọi (S5)
  return Promise.race([fn(), timeout]).finally(() => clearTimeout(timer));
}

async function probe(fn: () => Promise<unknown>): Promise<CheckState> {
  try {
    await withTimeout(fn);
    return "ok";
  } catch {
    return "fail"; // lỗi gốc bị nuốt tại đây — AC4
  }
}
