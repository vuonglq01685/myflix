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
const healthyRedis = () =>
  ({ ping: jest.fn().mockResolvedValue("PONG") }) as never as Redis;
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
      const controller = new HealthController(
        healthyPrisma(),
        healthyRedis(),
        healthyStorage(),
      );
      const res = mockRes();

      await controller.check(res);

      expect(fetchMock).toHaveBeenCalledWith(
        TRANSCODER_GPU_URL,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      const signal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
      expect(signal.aborted).toBe(false);
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
