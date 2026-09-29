import { Logger } from "@nestjs/common";
import type { Response } from "express";
import type Redis from "ioredis";
import { HealthController } from "./health.controller";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";

// mirrors TRANSCODER_GPU_URL in health.controller.ts (mission D7) — not exported, no new interface
const TRANSCODER_GPU_URL = "http://transcoder:4100/health/gpu";

const mockRes = () => ({ status: jest.fn() }) as unknown as Response;

const healthyPrisma = () =>
  ({
    $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]),
  }) as never as PrismaService;
// status: "ready" mở rộng fixture cho A5 r1 — redis.status gate trước khi ping()
const healthyRedis = () =>
  ({
    status: "ready",
    ping: jest.fn().mockResolvedValue("PONG"),
  }) as never as Redis;
const healthyStorage = () =>
  ({ ping: jest.fn().mockResolvedValue(undefined) }) as never as StorageService;

const mockGpuOk = () =>
  jest.spyOn(global, "fetch").mockResolvedValue({
    status: 200,
    json: async () => ({ gpu: "not_required" }),
  } as never);

describe("HealthController", () => {
  afterEach(() => jest.restoreAllMocks());

  it("reports ok on all four checks when every dependency is healthy", async () => {
    const prisma = healthyPrisma();
    const redis = healthyRedis();
    const storage = healthyStorage();
    jest.spyOn(global, "fetch").mockResolvedValue({
      status: 200,
      json: async () => ({ gpu: "ok" }),
    } as never);

    const controller = new HealthController(prisma, redis, storage);
    const res = mockRes();
    const body = await controller.check(res);

    expect(body).toMatchObject({
      status: "ok",
      checks: { postgres: "ok", redis: "ok", minio: "ok", gpu: "ok" },
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it("reports ok with gpu not_required when every other dependency is healthy", async () => {
    const prisma = healthyPrisma();
    const redis = healthyRedis();
    const storage = healthyStorage();
    mockGpuOk();

    const controller = new HealthController(prisma, redis, storage);
    const res = mockRes();
    const body = await controller.check(res);

    expect(body).toMatchObject({
      status: "ok",
      checks: {
        postgres: "ok",
        redis: "ok",
        minio: "ok",
        gpu: "not_required",
      },
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  describe("AC2 — 503 and per-check status when a dependency fails", () => {
    it("marks only postgres failed and returns 503", async () => {
      mockGpuOk();
      const prisma = {
        $queryRaw: jest.fn().mockRejectedValue(new Error("down")),
      } as never as PrismaService;
      const controller = new HealthController(
        prisma,
        healthyRedis(),
        healthyStorage(),
      );
      const res = mockRes();

      const body = await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(body).toMatchObject({
        status: "degraded",
        checks: {
          postgres: "fail",
          redis: "ok",
          minio: "ok",
          gpu: "not_required",
        },
      });
    });

    it("marks only redis failed and returns 503", async () => {
      mockGpuOk();
      const redis = {
        status: "ready", // A3 r1 — pass the fail-fast gate so the rejected ping path is what this case exercises
        ping: jest.fn().mockRejectedValue(new Error("down")),
      } as never as Redis;
      const controller = new HealthController(
        healthyPrisma(),
        redis,
        healthyStorage(),
      );
      const res = mockRes();

      const body = await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(body).toMatchObject({
        status: "degraded",
        checks: {
          postgres: "ok",
          redis: "fail",
          minio: "ok",
          gpu: "not_required",
        },
      });
    });

    it("marks only minio failed and returns 503", async () => {
      mockGpuOk();
      const storage = {
        ping: jest.fn().mockRejectedValue(new Error("down")),
      } as never as StorageService;
      const controller = new HealthController(
        healthyPrisma(),
        healthyRedis(),
        storage,
      );
      const res = mockRes();

      const body = await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(body).toMatchObject({
        status: "degraded",
        checks: {
          postgres: "ok",
          redis: "ok",
          minio: "fail",
          gpu: "not_required",
        },
      });
    });

    it("marks only gpu down and returns 503", async () => {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ status: 503, json: async () => ({}) } as never);
      const controller = new HealthController(
        healthyPrisma(),
        healthyRedis(),
        healthyStorage(),
      );
      const res = mockRes();

      const body = await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(body).toMatchObject({
        status: "degraded",
        checks: { postgres: "ok", redis: "ok", minio: "ok", gpu: "down" },
      });
    });
  });

  describe("AC3 — every check respects the 1s timeout budget", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("times out a hung redis.ping within CHECK_TIMEOUT_MS", async () => {
      mockGpuOk();
      const redis = {
        status: "ready", // A3 r1 — pass the fail-fast gate so withTimeout is what this case exercises
        ping: jest.fn(() => new Promise(() => {})),
      } as never as Redis;
      const controller = new HealthController(
        healthyPrisma(),
        redis,
        healthyStorage(),
      );
      const res = mockRes();

      const pending = controller.check(res);
      await jest.advanceTimersByTimeAsync(1_000);
      const body = await pending;

      expect(body.checks).toMatchObject({
        postgres: "ok",
        redis: "fail",
        minio: "ok",
        gpu: "not_required",
      });
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it("marks gpu unreachable when the transcoder probe hangs past CHECK_TIMEOUT_MS", async () => {
      jest
        .spyOn(global, "fetch")
        .mockImplementation(() => new Promise(() => {}));
      const controller = new HealthController(
        healthyPrisma(),
        healthyRedis(),
        healthyStorage(),
      );
      const res = mockRes();

      const pending = controller.check(res);
      await jest.advanceTimersByTimeAsync(1_000);
      const body = await pending;

      expect(body.checks.gpu).toBe("unreachable");
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it("aborts a losing gpu probe fetch instead of leaving the socket open past CHECK_TIMEOUT_MS", async () => {
      const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue({
        status: 200,
        json: async () => ({ gpu: "ok" }),
      } as never);
      const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
      const controller = new HealthController(
        healthyPrisma(),
        healthyRedis(),
        healthyStorage(),
      );
      const res = mockRes();

      await controller.check(res);

      expect(timeoutSpy).toHaveBeenCalledWith(1_000); // mission D8 — abort tied to CHECK_TIMEOUT_MS
      expect(fetchMock).toHaveBeenCalledWith(
        TRANSCODER_GPU_URL,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(signal.aborted).toBe(false);
    });
  });

  describe("A5 r1 SUGGESTED 3 — abort the minio probe on timeout, fail redis fast when not ready", () => {
    it("fails redis fast without calling ping when status is not ready", async () => {
      mockGpuOk();
      const ping = jest.fn();
      const redis = { status: "reconnecting", ping } as never as Redis;
      const controller = new HealthController(
        healthyPrisma(),
        redis,
        healthyStorage(),
      );
      const res = mockRes();

      const body = await controller.check(res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(body.checks.redis).toBe("fail");
      expect(ping).not.toHaveBeenCalled(); // A5 r1 — không xếp PING vào offline queue của ioredis khi mất kết nối
    });

    it("aborts the storage.ping probe with an AbortSignal tied to CHECK_TIMEOUT_MS", async () => {
      mockGpuOk();
      const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
      const storage = healthyStorage();
      const controller = new HealthController(
        healthyPrisma(),
        healthyRedis(),
        storage,
      );
      const res = mockRes();

      await controller.check(res);

      expect(storage.ping).toHaveBeenCalledWith(expect.any(AbortSignal));
      const storageSignal = (storage.ping as jest.Mock).mock.calls[0]?.[0];
      const storageCall = timeoutSpy.mock.results.findIndex(
        (r) => r.value === storageSignal,
      );
      expect(storageCall).toBeGreaterThanOrEqual(0);
      expect(timeoutSpy.mock.calls[storageCall]).toEqual([1_000]); // mission D8 — the storage signal, not the gpu one
    });
  });

  describe("A5 r2 SUGGESTED 3 — log a warning on the ok -> fail edge", () => {
    const redisWith = (ping: jest.Mock) =>
      ({ status: "ready", ping }) as never as Redis;
    const build = (redis: Redis) =>
      new HealthController(healthyPrisma(), redis, healthyStorage());

    it("warns once naming the check and the cause, while the body stays free of the cause", async () => {
      mockGpuOk();
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      const redis = redisWith(jest.fn().mockRejectedValue(new Error("boom")));

      const body = await build(redis).check(mockRes());

      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain("redis");
      expect(line).toContain("boom");
      expect(JSON.stringify(body)).not.toContain("boom");
    });

    it("stays quiet while the same check keeps failing", async () => {
      mockGpuOk();
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      const controller = build(
        redisWith(jest.fn().mockRejectedValue(new Error("boom"))),
      );

      await controller.check(mockRes());
      await controller.check(mockRes());

      expect(warn).toHaveBeenCalledTimes(1);
    });

    it("warns again when a check fails, recovers, then fails again", async () => {
      mockGpuOk();
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      const ping = jest
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce("PONG")
        .mockRejectedValueOnce(new Error("boom"));
      const controller = build(redisWith(ping));

      await controller.check(mockRes());
      await controller.check(mockRes());
      await controller.check(mockRes());

      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("warns naming gpu when the transcoder answers 503", async () => {
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue({ status: 503, json: async () => ({}) } as never);

      await build(healthyRedis()).check(mockRes());

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("gpu");
    });

    it("warns naming gpu and the cause when the transcoder fetch rejects", async () => {
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(global, "fetch").mockRejectedValue(new Error("fetch failed"));

      await build(healthyRedis()).check(mockRes());

      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0]?.[0]);
      expect(line).toContain("gpu");
      expect(line).toContain("fetch failed");
    });

    it.each([
      [
        "postgres",
        () =>
          new HealthController(
            {
              $queryRaw: jest.fn().mockRejectedValue(new Error("boom")),
            } as never as PrismaService,
            healthyRedis(),
            healthyStorage(),
          ),
      ],
      [
        "minio",
        () =>
          new HealthController(healthyPrisma(), healthyRedis(), {
            ping: jest.fn().mockRejectedValue(new Error("boom")),
          } as never as StorageService),
      ],
    ])("warns naming %s when only that check fails", async (name, make) => {
      mockGpuOk();
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();

      await make().check(mockRes());

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(`${name} check failed`);
    });

    it("does not warn when everything is healthy", async () => {
      mockGpuOk();
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();

      await build(healthyRedis()).check(mockRes());

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("AC4 — never leaks raw error detail into the response body", () => {
    it("keeps a raw postgres error message out of the body", async () => {
      mockGpuOk();
      const prisma = {
        $queryRaw: jest
          .fn()
          .mockRejectedValue(
            new Error("ECONNREFUSED 10.0.0.1:5432 password=x"),
          ),
      } as never as PrismaService;
      const controller = new HealthController(
        prisma,
        healthyRedis(),
        healthyStorage(),
      );
      const res = mockRes();

      const body = await controller.check(res);

      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain("ECONNREFUSED");
      expect(serialized).not.toContain("5432");
      expect(serialized).not.toContain("password");
      expect(body.checks.postgres).toBe("fail");
    });

    it("treats an unexpected gpu body string as unreachable rather than passing it through", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({
        status: 200,
        json: async () => ({ gpu: "ECONNREFUSED 10.0.0.1:4100" }),
      } as never);
      const controller = new HealthController(
        healthyPrisma(),
        healthyRedis(),
        healthyStorage(),
      );
      const res = mockRes();

      const body = await controller.check(res);

      expect(body.checks.gpu).toBe("unreachable");
    });
  });
});
