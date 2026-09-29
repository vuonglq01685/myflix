import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

/**
 * Integration tests run against real Postgres / Redis / MinIO (doc 13 §4):
 * no mocks below the HTTP layer. Bring them up with
 *
 *   make test-e2e        # compose + host-published ports, then this suite
 *
 * DATABASE_URL etc. must point at localhost — see docker-compose.test.yml.
 */
const hasInfra = Boolean(process.env.DATABASE_URL?.includes("localhost"));
const suite = hasInfra ? describe : describe.skip;

suite("GET /api/health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Imported lazily: AppModule validates the environment at import time,
    // which would abort the run instead of skipping it when infra is absent.
    const { AppModule } = await import("../src/app.module");
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(() => app?.close());

  it("reports postgres/redis/minio ok and a valid gpu contract (DoD-0-1)", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");

    // Finding 5: on the host, `transcoder` doesn't resolve via compose DNS,
    // so checks.gpu is always "unreachable" here — this only checks the
    // contract, not a specific gpu value.
    expect(res.body.checks).toMatchObject({
      postgres: "ok",
      redis: "ok",
      minio: "ok",
    });
    expect(["ok", "not_required", "down", "unreachable"]).toContain(
      res.body.checks.gpu,
    );
    expect(res.status).toBe(res.body.status === "ok" ? 200 : 503);
  });
});
