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

  it("reports every dependency ok and 200 when the stack is up (DoD-0-1)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/health")
      .expect(200);
    expect(res.body.checks).toMatchObject({ postgres: "ok", redis: "ok" });
    expect(res.body.queue).toEqual({
      waiting: expect.any(Number),
      active: expect.any(Number),
    });
  });
});
