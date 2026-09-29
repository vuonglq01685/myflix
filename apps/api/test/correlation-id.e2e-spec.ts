import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

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

// Same shape as crypto.randomUUID() output — mirrors Task 2's
// correlation-id.test.ts (S5); test files don't share a module.
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

suite("Correlation id echo + fallback (AC5/AC6/AC10)", () => {
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
    // R4-S2: AllExceptionsFilter is only in AppModule.providers, not APP_FILTER
    // — register it the same way main.ts:22 does, before app.init().
    app.useGlobalFilters(app.get(AllExceptionsFilter));
    await app.init();
  });

  afterAll(() => app?.close());

  it("echoes a valid client-supplied correlation id (T7)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/health")
      .set("X-Correlation-Id", "t7-probe-0001")
      .expect(200);
    expect(res.headers["x-correlation-id"]).toBe("t7-probe-0001");
  });

  it("generates a UUID v4 when no header is sent (T8)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/health")
      .expect(200);
    expect(res.headers["x-correlation-id"]).toMatch(UUID_V4_REGEX);
  });

  it("still echoes X-Correlation-Id on an unexpected 500 (T9)", async () => {
    const { AuthService } = await import("../src/auth/auth.service");
    jest
      .spyOn(app.get(AuthService), "login")
      .mockRejectedValueOnce(new Error("boom"));

    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "t9@example.com", password: "x" })
      .expect(500);
    expect(res.headers["x-correlation-id"]).toBeDefined();
  });

  it("regenerates a fresh UUID v4 when the client header is too long (T10)", async () => {
    const tooLong = "a".repeat(65);
    const res = await request(app.getHttpServer())
      .get("/api/health")
      .set("X-Correlation-Id", tooLong)
      .expect(200);
    expect(res.headers["x-correlation-id"]).toMatch(UUID_V4_REGEX);
    expect(res.headers["x-correlation-id"]).not.toBe(tooLong);
  });

  it("still echoes X-Correlation-Id on a body-parser JSON error (R3-S4)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"')
      .expect(400);
    expect(res.headers["x-correlation-id"]).toMatch(UUID_V4_REGEX);
  });
});
