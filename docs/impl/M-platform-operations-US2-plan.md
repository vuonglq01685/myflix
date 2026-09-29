# Implementation plan — M-platform-operations-US2 (F-045: Health check & log tập trung)

cmd.test: pnpm -r test
cmd.lint: npx eslint . && npx prettier --check .
status: approved

> Source design: `docs/impl/M-platform-operations-US2-design.md` (status: approved, path: architectural).
> Ticket: `myflix-ba/tickets/M-platform-operations-US2.md` (AC1–AC10, `## Test data & verification` T1–T14 cộng T2b/T3b/T4b/T4c/T12b).
> Ticket phủ 2 việc độc lập cùng chạm `api`, `web`, `transcoder`: (a) endpoint health kiểm 4 phụ thuộc (postgres/redis/minio/gpu), (b) `correlationId` xuyên request → log → hàng đợi, cộng che 3 header nhạy cảm. Không có bảng nào được tạo hay sửa.
> `OPEN(BA)` (thiết kế §5, ## OPEN items): AC9 chỉ nghiệm thu được ở tầng processor (`processor.process(fakeJob)` trực tiếp) vì 3/4 điểm đẩy job trong `api` là stub Phase 1 (`NotImplementedException`) — Task 7 dựng đúng phần D11 và test bằng enqueue trực tiếp, không phải "request → enqueue" như văn bản AC9 mô tả. BA quyết định nghiệm thu ở mức này hay dời sang ticket ingest.

## Task 1: AC1 — `packages/storage`: `StorageClient.ping()`

Depends on: none

**Files**

- Create: `packages/storage/src/storage.client.ping.test.ts`
- Modify: `packages/storage/src/storage.client.ts`
- Modify: `packages/storage/package.json` (`scripts.test`)

**Interfaces**

- Consumes: none.
- Produces: `StorageClient.ping(): Promise<void>` — `apps/api/src/storage/storage.service.ts`'s `StorageService extends StorageClient`, nên `StorageService` thừa kế `ping()` miễn phí; Task 3 (`HealthController`) gọi `this.storage.ping()`. Mechanism (design §3.2): `await this.s3.send(new HeadBucketCommand({ Bucket: this.buckets.source }))`, dùng lại field `s3`/`buckets` đã có trong class, import `HeadBucketCommand` thêm vào import list có sẵn của `@aws-sdk/client-s3` ở đầu file. Không thêm dependency mới.
- `packages/storage`'s current `test` script (`"echo 'covered by integration tests against a real MinIO container'"`) không chạy test nào — sửa thành `"tsc -p tsconfig.json && node --test dist/storage.client.ping.test.js"` (một file cụ thể, không dùng glob — chỉ 1 file test tồn tại trong package này, không cần `dist/**/*.test.js` như `packages/shared` — YAGNI).

**Steps**

- [x] Failing test: viết `packages/storage/src/storage.client.ping.test.ts` (dùng `node:test` + `node:assert/strict`, cùng phong cách `packages/shared/src/media/media.test.ts`) — monkey-patch `S3Client.prototype.send` để ghi lại lệnh gửi đi, dựng `new StorageClient({ endpoint: "http://localhost:9000", region: "us-east-1", accessKeyId: "x", secretAccessKey: "x", buckets: { source: "myflix-source", media: "myflix-media", images: "myflix-images", staging: "myflix-staging" } })`, gọi `await client.ping()`, assert lệnh gửi đi là 1 `HeadBucketCommand` với `input.Bucket === "myflix-source"`; khôi phục `S3Client.prototype.send` gốc trong `finally`. Chạy `pnpm --filter @myflix/storage test` (tạm sửa `scripts.test` trước — xem bước tiếp). Expect: FAIL — `tsc -p tsconfig.json` báo `TS2339: Property 'ping' does not exist on type 'StorageClient'` (method chưa tồn tại).
- [x] Sửa `scripts.test` trong `packages/storage/package.json` thành `"tsc -p tsconfig.json && node --test dist/storage.client.ping.test.js"`.
- [x] Thêm `HeadBucketCommand` vào import list `@aws-sdk/client-s3` ở đầu `storage.client.ts`; thêm method `ping()` như trên vào cuối class `StorageClient`.
- [x] Chạy lại `pnpm --filter @myflix/storage test`. Expect: PASS — `tsc` sạch, `node --test` báo 1 test pass.
- [x] Self-review checkpoint: `ping()` không thêm field/constructor param nào; chỉ dùng lại `this.s3`/`this.buckets.source` đã có.
- [x] Chạy `pnpm --filter @myflix/storage test` (scoped) và `cmd.lint`. Paste output vào PR.
- [x] Commit: `feat(storage): add StorageClient.ping() for health check probe`.

Review: ✅ r1

## Task 2: AC5/AC6/AC7/AC9/AC10 — `packages/shared`: `correlation-id.ts` + `log-redact.ts`

Depends on: none

**Files**

- Create: `packages/shared/src/correlation-id.ts`
- Create: `packages/shared/src/correlation-id.test.ts`
- Create: `packages/shared/src/log-redact.ts`
- Create: `packages/shared/src/log-redact.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

**Interfaces**

- Consumes: none.
- Produces (dùng bởi Task 3 gián tiếp không — Task 6, 7, 8 tiêu thụ trực tiếp):
  - `isValidCorrelationId(v: unknown): v is string` — regex `^[A-Za-z0-9._-]{1,64}$` (mission D9, US2 AC7).
  - `generateCorrelationId(): string` — `globalThis.crypto.randomUUID()` (Web Crypto global, KHÔNG `node:crypto` — chạy được cả Node lẫn Next.js Edge Runtime; mission D9 + Finding 4 của design).
  - `resolveCorrelationId(candidate?: string | null): string` — trả `candidate` nếu `isValidCorrelationId(candidate)`, ngược lại `generateCorrelationId()`.
  - `LOG_REDACT_CONFIG` — `{ paths: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'], censor: "[REDACTED]" }` (mission D10; đúng 3 header, không có danh sách trường body vì pino-http mặc định không log body).
  - Export path kép trong `packages/shared/package.json#exports`: `"."` (barrel, dùng bởi `api`/`transcoder`) và `"./correlation-id"` (subpath, dùng bởi `web` middleware — Edge Runtime, không kéo theo `./password` → `@node-rs/argon2`, native addon không chạy được trên Edge).
  - `packages/shared/src/index.ts` thêm `export * from "./correlation-id";` và `export * from "./log-redact";`.

**Steps**

- [x] Failing test: viết `packages/shared/src/correlation-id.test.ts` (`node:test`) — case `resolveCorrelationId(undefined)` khớp regex UUID v4 `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`; case `resolveCorrelationId("t7-probe-0001")` trả nguyên giá trị; case chuỗi 65 ký tự → sinh giá trị mới (không phải chuỗi gốc); case chuỗi chứa `"\n"` → sinh giá trị mới; case `isValidCorrelationId("bad id")` (khoảng trắng) → `false`. Viết `packages/shared/src/log-redact.test.ts` — assert `LOG_REDACT_CONFIG.paths` deep-equal đúng 3 chuỗi trên theo đúng thứ tự, `LOG_REDACT_CONFIG.censor === "[REDACTED]"`. Chạy `pnpm --filter @myflix/shared test`. Expect: FAIL — `tsc -p tsconfig.json` báo `TS2307: Cannot find module './correlation-id'` / `'./log-redact'` (file chưa tồn tại).
- [x] Tạo `packages/shared/src/correlation-id.ts` và `packages/shared/src/log-redact.ts` đúng nội dung ở Interfaces.
- [x] Thêm 2 dòng export vào `packages/shared/src/index.ts`.
- [x] Sửa `packages/shared/package.json`: thêm khối `"./correlation-id"` vào `exports`; sửa `scripts.test` từ `"tsc -p tsconfig.json && node --test dist/media/*.test.js"` thành `"tsc -p tsconfig.json && node --test 'dist/**/*.test.js'"` — **dấu nháy đơn bắt buộc** (S4 của design: pnpm chạy script `test` qua `sh`, `sh` không hỗ trợ globstar `**`; để trần thì shell tự giãn glob trước khi Node thấy, chỉ khớp `dist/<1 thư mục>/*.test.js`, bỏ sót `dist/correlation-id.test.js`/`dist/log-redact.test.js` ở gốc `dist/`). Không đổi glob này thì CI không bao giờ chạy 2 test mới.
- [x] Chạy lại `pnpm --filter @myflix/shared test`. Expect: PASS — `tsc` sạch, `node --test` báo tests từ cả `dist/correlation-id.test.js`, `dist/log-redact.test.js` lẫn `dist/media/media.test.js` (tổng số test tăng so với trước).
- [x] Self-review checkpoint: `correlation-id.ts` không import gì (giữ subpath sạch khỏi graph `password.ts`/argon2); `log-redact.ts` là literal thuần, không logic.
- [x] Chạy `pnpm --filter @myflix/shared test` (scoped) và `cmd.lint`. Paste output vào PR.
- [x] Commit: `feat(shared): add correlation-id and log-redact helpers (D9, D10)`.

Review: ✅ r2

## Task 3: AC1/AC2/AC3/AC4 — `apps/api`: `HealthController` rewrite

Depends on: task 1, task 4

**Files**

- Modify: `apps/api/src/health/health.controller.ts`
- Create: `apps/api/src/health/health.controller.spec.ts`
- Modify: `apps/api/test/health.e2e-spec.ts` (viết lại toàn bộ)

**Interfaces**

- Consumes: `StorageClient.ping(): Promise<void>` (Task 1, thừa kế qua `StorageService extends StorageClient`, đã global-provided bởi `StorageModule`, không cần sửa `health.module.ts`); `GET http://transcoder:4100/health/gpu` → `{ gpu: "ok" | "not_required" | "down" }` HTTP 200/503 (Task 4 produce — `probeGpu()` dưới đây gọi đúng contract này; test unit của Task 3 mock `global.fetch` nên không cần Task 4 chạy thật, nhưng contract phải khớp).
- Body shape (Q4, chốt ở design §3):
  ```ts
  type CheckState = "ok" | "fail";
  type GpuState = "ok" | "not_required" | "down" | "unreachable";
  interface HealthBody {
    status: "ok" | "degraded";
    checks: {
      postgres: CheckState;
      redis: CheckState;
      minio: CheckState;
      gpu: GpuState;
    };
    version: string;
  }
  ```
  `healthy = postgres==="ok" && redis==="ok" && minio==="ok" && (gpu==="ok" || gpu==="not_required")`; `status: healthy?"ok":"degraded"`; HTTP `200`/`503` tương ứng, `res.status(503)` khi không healthy (giữ pattern hiện có).
- `CHECK_TIMEOUT_MS = 1_000` (mission D8). `TRANSCODER_GPU_URL = "http://transcoder:4100/health/gpu"` — hằng số trong file, KHÔNG qua `ConfigService`/env (D7: không thêm env key mới cho `api`).
- Constructor: bỏ `@InjectQueue(QUEUE_TRANSCODE) private readonly queue: Queue` và import `InjectQueue`/`Queue`/`QUEUE_TRANSCODE` — thêm `private readonly storage: StorageService` (import từ `"../storage/storage.service"`). Chữ ký constructor mới: `(prisma: PrismaService, @Inject(REDIS) redis: Redis, storage: StorageService)`.
- `probeGpu()`: `fetch(TRANSCODER_GPU_URL)` bên trong `withTimeout()`; `res.status === 503` → `"down"`; body `{ gpu?: unknown }`, `gpu === "ok" || gpu === "not_required"` → trả nguyên, ngược lại `"unreachable"`; catch (từ chối kết nối HOẶC quá `CHECK_TIMEOUT_MS`) → `"unreachable"`.
- `withTimeout<T>(fn)`: `Promise.race([fn(), timeout])`, `.finally(() => clearTimeout(timer))` — không rò timer.
- `probe(fn)`: **bọc `fn` trong `withTimeout(fn)`** (không gọi `fn()` trần) — `try { await withTimeout(fn); return "ok"; } catch { return "fail"; }` — nếu thiếu bọc này thì AC3 (ngân sách 1.000 ms) hở ở 3 check `postgres`/`redis`/`minio`, chỉ `probeGpu` có timeout. Catch nuốt lỗi gốc, trả `"fail"` — không bao giờ đưa `error.message` vào body (AC4).
- `check()`: chạy `Promise.all` cả 4 probe song song — `probe(() => this.prisma.$queryRaw`SELECT 1`)`, `probe(() => this.redis.ping())`, `probe(() => this.storage.ping())`, `probeGpu()` — rồi gộp vào `checks = { postgres, redis, minio, gpu }`.
- Full nội dung viết lại (copy nguyên văn, không đổi):
  ```ts
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
        const res = await fetch(TRANSCODER_GPU_URL);
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
  ```
- `health.module.ts`: KHÔNG sửa — `StorageModule` đã `@Global()`.
- Produces (cho Task closing): endpoint `GET /api/health` (qua nginx, path không đổi — Q5 đã đóng: healthcheck compose hiện tại gọi đúng `http://localhost:4000/api/health` bên trong container, controller phục vụ đúng path đó qua `setGlobalPrefix("api")` + `@Controller("health")`).

**Steps**

- [x] Failing test: viết `apps/api/src/health/health.controller.spec.ts` [NEW] — dựng `HealthController` với `PrismaService`/`redis`/`StorageService` mock (`jest.fn()`). Case 1: mock cả 4 `ok` → assert `res.body`/return value có đủ 4 khoá `postgres/redis/minio/gpu`, `status: "ok"`, không gọi `res.status(503)`. Chạy `pnpm --filter @myflix/api test -- health.controller`. Expect: FAIL — import `HealthController` hiện tại có constructor nhận `Queue`, không có `StorageService`; `checks` trả về chỉ có `postgres`/`redis` — assertion "đủ 4 khoá" fail ngay (thiếu `minio`, `gpu`), hoặc TS compile lỗi nếu mock `StorageService` không khớp constructor thật.
- [x] Thêm case 2 (AC2): mock lần lượt `prisma`/`redis`/`storage.ping` reject, `probeGpu` (mock `global.fetch`) trả `down` → assert `503` (gọi `res.status` với `503`) + đúng field sai + 3 field còn lại `"ok"`. Case 3 (AC3): mọi case trong file này mock `global.fetch` (kể cả case không test GPU) để `probeGpu` không bao giờ gọi mạng thật. `redis.ping` trả `Promise` không bao giờ resolve (khớp harness T5 ở Task 5/Task 9 — dependency treo thật ở compose là `redis`), dùng `jest.useFakeTimers()` + `jest.advanceTimersByTimeAsync(1000)`; assert `check()` resolve trong ngân sách `CHECK_TIMEOUT_MS`, `checks.redis === "fail"`, 3 check còn lại (`postgres`/`minio`/`gpu`) vẫn `"ok"`/`"not_required"`, `res.status` được gọi với `503`. Thêm case `global.fetch` treo (không bao giờ resolve) → assert `checks.gpu === "unreachable"` trong cùng ngân sách 1.000 ms. RED cho cả 2 case: code hiện tại (`probe()` không bọc `withTimeout`) không có timeout → Jest hết giờ mặc định thay vì resolve trong `advanceTimersByTimeAsync(1000)`. Case 4 (AC4): mock `prisma.$queryRaw` reject với `Error("ECONNREFUSED 10.0.0.1:5432 password=x")`, assert `JSON.stringify(result)` không chứa `ECONNREFUSED`/`5432`/`password`; case `probeGpu` với body `{ gpu: "ECONNREFUSED 10.0.0.1:4100" }` (chuỗi lạ) → assert `checks.gpu === "unreachable"`.
- [x] Viết lại toàn bộ `apps/api/src/health/health.controller.ts` theo nội dung ở Interfaces (copy nguyên văn từ design §3).
- [x] Chạy lại `pnpm --filter @myflix/api test -- health.controller`. Expect: PASS — cả 4 case xanh.
- [x] Viết lại toàn bộ `apps/api/test/health.e2e-spec.ts` (S8): bỏ `.expect(200)` cứng và assertion `res.body.queue` (field không còn tồn tại); thay bằng: gọi `GET /api/health`, assert `checks.postgres === "ok"`, `checks.redis === "ok"`, `checks.minio === "ok"` (infra thật khi chạy `make test-e2e`), `checks.gpu` thuộc `["ok","not_required","down","unreachable"]` (Finding 5: khi chạy trên host, `transcoder` không resolve được qua DNS compose → `checks.gpu` luôn `"unreachable"` — test chỉ kiểm hợp đồng, không kiểm giá trị cụ thể), `res.status` khớp `res.body.status` (`200` khi `"ok"`, `503` khi `"degraded"`). Giữ nguyên guard `hasInfra`/`describe.skip` đã có.
- [x] Chạy `pnpm --filter @myflix/api test:e2e -- health` nếu có infra local (`make test-e2e`); nếu không có infra, ghi rõ trong PR là suite tự skip (`hasInfra` false) — không phải bằng chứng thiếu.
- [x] Self-review checkpoint: đối chiếu 4 case unit test với đúng 4 dòng AC1–AC4 trong `## Test data & verification` của ticket (T1, T2/T3/T3b, T5, T6); xác nhận không còn tham chiếu `queue`/`BullMQ` nào trong `health.controller.ts`.
- [x] Chạy `pnpm --filter @myflix/api test` (scoped) và `cmd.lint`. Paste output vào PR.
- [x] Commit: `feat(api): health endpoint checks postgres/redis/minio/gpu, drops queue count (D7, Q2)`.

Review: ✅ r2 (S3/S4 → Task 10, Dev-approved)

## Task 4: AC1/AC2 — `apps/transcoder`: GPU probe HTTP listener

Depends on: none

**Files**

- Modify: `apps/transcoder/src/main.ts`
- Modify: `apps/transcoder/src/app.module.ts` (thêm `HealthModule` vào `imports`)
- Modify: `apps/transcoder/package.json` (thêm dependency `@nestjs/platform-express`)
- Modify: `pnpm-lock.yaml`
- Create: `apps/transcoder/src/health/gpu-probe.service.ts`
- Create: `apps/transcoder/src/health/gpu-probe.controller.ts`
- Create: `apps/transcoder/src/health/gpu-probe.controller.spec.ts`
- Create: `apps/transcoder/src/health/health.module.ts`

**Interfaces**

- Consumes: none.
- Produces: `GET http://transcoder:4100/health/gpu` — body `{ gpu: "ok" | "not_required" | "down" }` (transcoder tự trả 3/4 giá trị; `"unreachable"` là diễn giải phía `api` khi probe bị từ chối/quá hạn — xem Task 3). `not_required` khi `TRANSCODE_ENCODER` không kết thúc bằng `_nvenc` (Q3/D7, nhánh CPU). `down` (HTTP 503, qua `ServiceUnavailableException({ gpu: "down" })`) khi `GpuProbeService.read()` false. `ok` (HTTP 200) khi `read()` true.
- `GPU_PROBE_PORT = 4100` — hằng số trong `main.ts`, chỉ nội bộ mạng compose, không publish ra host (B3/D7).
- `GpuProbeService`: `GPU_CHECK_INTERVAL_MS = 10_000`, `GPU_STALE_MS = 30_000` (cũ hơn = `down`, phủ cả `nvidia-smi` treo); `execFileAsync("nvidia-smi", ["-L"], { timeout: 5_000 })` (ponytail: timeout cố định 5s, kill tiến trình treo thay vì dồn qua mỗi vòng 10s); `onModuleInit` chạy `runCheck()` ngay rồi `setInterval(...).unref()`; `onModuleDestroy` clear interval; `read(): boolean` trả `lastOk && Date.now() - lastCheckedAt <= GPU_STALE_MS`.
- `GpuProbeController.check()`: đọc `this.config.get<string>("TRANSCODE_ENCODER", "h264_nvenc")` — schema Zod có sẵn ở `apps/transcoder/src/config/env.ts:25` (`z.string().default("h264_nvenc")`), không cần sửa schema.
- **NS2 — không dùng `@Res`/`Response`**: `apps/transcoder/package.json` không có `express`/`@types/express` type; dùng `ServiceUnavailableException` để Nest tự set HTTP 503.
- `GpuProbeService.runCheck()` (`private async`, gọi bởi `onModuleInit` và `setInterval`): `try { await execFileAsync("nvidia-smi", ["-L"], { timeout: 5_000 }); this.lastOk = true; } catch { this.lastOk = false; } finally { this.lastCheckedAt = Date.now(); }` — `lastCheckedAt` LUÔN được set trong `finally`, bất kể try hay catch, để `read()`'s ngưỡng `GPU_STALE_MS` đúng cả khi lệnh fail lẫn khi pass.
- `main.ts`'s `bootstrap()` — thân hàm đầy đủ, giữ nguyên các dòng đã có (`bufferLogs`, `useLogger`, `enableShutdownHooks`), chỉ đổi factory method và thêm `listen`:
  ```ts
  const GPU_PROBE_PORT = 4100; // mission D7 — chỉ nội bộ mạng compose, không publish ra host

  async function bootstrap(): Promise<void> {
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    app.useLogger(app.get(Logger));
    app.enableShutdownHooks();
    await app.listen(GPU_PROBE_PORT, "0.0.0.0");
  }
  ```
- Full nội dung 4 file mới — copy nguyên văn:
  ```ts
  // apps/transcoder/src/health/gpu-probe.service.ts
  const GPU_CHECK_INTERVAL_MS = 10_000; // mission D7
  const GPU_STALE_MS = 30_000; // mission D7 — cũ hơn ngưỡng này = down, phủ cả trường hợp nvidia-smi treo
  const execFileAsync = promisify(execFile); // node:child_process + node:util — stdlib

  @Injectable()
  export class GpuProbeService implements OnModuleInit, OnModuleDestroy {
    private lastOk = false;
    private lastCheckedAt = 0;
    private timer?: NodeJS.Timeout;

    async onModuleInit(): Promise<void> {
      await this.runCheck();
      this.timer = setInterval(
        () => void this.runCheck(),
        GPU_CHECK_INTERVAL_MS,
      );
      this.timer.unref();
    }
    onModuleDestroy(): void {
      if (this.timer) clearInterval(this.timer);
    }

    private async runCheck(): Promise<void> {
      try {
        // ponytail: timeout cố định 5s để một lần nvidia-smi treo bị kill thay vì
        // dồn tiến trình con qua mỗi vòng 10s; nếu cần dài hơn thì đưa ra env var.
        await execFileAsync("nvidia-smi", ["-L"], { timeout: 5_000 });
        this.lastOk = true;
      } catch {
        this.lastOk = false;
      } finally {
        this.lastCheckedAt = Date.now();
      }
    }

    read(): boolean {
      return this.lastOk && Date.now() - this.lastCheckedAt <= GPU_STALE_MS;
    }
  }
  ```
  ```ts
  // apps/transcoder/src/health/gpu-probe.controller.ts
  import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
  import { ConfigService } from "@nestjs/config";

  type GpuState = "ok" | "not_required" | "down"; // transcoder tự trả 3/4 giá trị — "unreachable" là diễn giải phía api

  @Controller("health")
  export class GpuProbeController {
    constructor(
      private readonly config: ConfigService,
      private readonly probe: GpuProbeService,
    ) {}

    @Get("gpu")
    check(): { gpu: GpuState } {
      const encoder = this.config.get<string>(
        "TRANSCODE_ENCODER",
        "h264_nvenc",
      );
      if (!encoder.endsWith("_nvenc")) return { gpu: "not_required" }; // Q3/D7 — nhánh CPU

      if (this.probe.read()) return { gpu: "ok" };
      throw new ServiceUnavailableException({ gpu: "down" }); // body {"gpu":"down"} + HTTP 503, đúng D7
    }
  }
  ```
  `apps/transcoder/src/health/health.module.ts`: `controllers: [GpuProbeController], providers: [GpuProbeService]`.
- Naming (Finding 8 của design): thư mục `apps/transcoder/src/health/` đặt `gpu-probe.controller.ts`/`gpu-probe.service.ts`/`health.module.ts` — theo đúng pattern `apps/api/src/health/` (controller + module), thêm service vì logic polling tách khỏi HTTP handler.
- Sau khi sửa `package.json`, chạy `pnpm install` để cập nhật `pnpm-lock.yaml` — bắt buộc vì `ci.yml` dùng `pnpm install --frozen-lockfile`.

**Steps**

- [x] Failing test: viết `apps/transcoder/src/health/gpu-probe.controller.spec.ts` [NEW] — dựng `GpuProbeController` với `ConfigService`/`GpuProbeService` mock. Case 1: `config.get` trả `"libx264"` (không `_nvenc`) → assert `check()` trả `{ gpu: "not_required" }` bất kể `probe.read()`. Case 2: `config.get` trả `"h264_nvenc"`, `probe.read()` trả `true` → assert `{ gpu: "ok" }`. Case 3: `config.get` trả `"h264_nvenc"`, `probe.read()` trả `false` → assert `check()` `throw ServiceUnavailableException` với response body `{ gpu: "down" }`. Chạy `pnpm --filter @myflix/transcoder test -- gpu-probe`. Expect: FAIL — module `./gpu-probe.controller` chưa tồn tại (`TS2307`/Jest "Cannot find module").
- [x] Tạo `gpu-probe.service.ts`, `gpu-probe.controller.ts`, `health.module.ts` đúng nội dung ở Interfaces.
- [x] Thêm `HealthModule` vào `apps/transcoder/src/app.module.ts`'s `imports` (import thêm, không đổi gì khác trong file này ở task này).
- [x] Sửa `apps/transcoder/src/main.ts`: đổi bootstrap sang `NestFactory.create` + `app.listen(GPU_PROBE_PORT, "0.0.0.0")` như Interfaces; cập nhật comment đầu file (không còn "Headless worker: no HTTP listener").
- [x] Thêm `@nestjs/platform-express` (`^11.0.0`) vào `dependencies` của `apps/transcoder/package.json`; chạy `pnpm install` ở root, xác nhận `pnpm-lock.yaml` cập nhật.
- [x] Chạy lại `pnpm --filter @myflix/transcoder test -- gpu-probe`. Expect: PASS — cả 3 case xanh.
- [x] Self-review checkpoint: xác nhận không import `express`/`Response` type nào trong `gpu-probe.controller.ts` (NS2); `main.ts` không publish port ra host (không có `ports:` — đó là việc của Task 5).
- [x] Chạy `pnpm --filter @myflix/transcoder test` (scoped), `pnpm --filter @myflix/transcoder build` (xác nhận `nest build` xanh với `@nestjs/platform-express` mới), và `cmd.lint`. Paste output vào PR.
- [x] Commit: `feat(transcoder): add GPU probe HTTP listener on :4100 (D7)`.

Review: ✅ r1 (S1/S2 → Task 11, Dev-approved)

## Task 5: AC2/AC3 — `docker-compose.yml`: transcoder expose 4100 + api healthcheck timeout/retries

Depends on: task 4

**Files**

- Modify: `docker-compose.yml`

**Interfaces**

- Consumes: `GPU_PROBE_PORT = 4100` (Task 4 — port thật GPU probe HTTP listener của `transcoder` lắng nghe).
- Current state (đọc trực tiếp, session này): `services.api.healthcheck` ở dòng 99–110 — `test` (dòng 100–106, không đổi), `interval: 10s` (dòng 107, không đổi), `timeout: 5s` (dòng 108), `retries: 10` (dòng 109), `start_period: 40s` (dòng 110, không đổi). `services.transcoder` (dòng 113–146) hiện không có khoá `expose`.
- Target state: dòng 108 `timeout: 5s` → `timeout: 3s`; dòng 109 `retries: 10` → `retries: 3` (mission D8/Q14 — chỉ 2 giá trị này đổi, `interval`/`start_period` giữ nguyên). Thêm `expose: ["4100"]` vào `services.transcoder` (theo dominant style của repo — `postgres`/`redis` đều khai `expose`; KHÔNG bắt buộc kỹ thuật vì container cùng mạng compose gọi nhau theo tên service bất kể có `expose` hay không — Finding 11 của design). KHÔNG thêm `ports:` ra host cho `transcoder` (B3/D7: cổng 4100 chỉ trong mạng compose). KHÔNG sửa `environment` của `api` (B3 — D7: không thêm env key mới; URL GPU probe là hằng số trong code, Task 3).
- `infra/compose/docker-compose.test.yml`, `.env.example`: KHÔNG đổi (B3 — xem design §8, Finding của US1 AC22 không bị động).
- `scripts/verify-phase0.sh`: KHÔNG đổi nội dung (design §9 — không có dòng nào cần sửa: subcheck `"api /health"` chỉ gọi `fetch(...).then(r=>{if(!r.ok)process.exit(1)})`, không hard-code `timeout`/`retries`). Nghĩa vụ US1 AC27 thoả bằng cách **chạy lại** script trong cùng PR (Task 9), không phải một diff — ghi rõ trong PR để tránh hiểu nhầm là bỏ sót.

**Steps**

- [x] Failing test: `docker compose config --format json | jq -e '.services.api.healthcheck.timeout == "3s" and .services.api.healthcheck.retries == 3'`. Expect: FAIL — `timeout` hiện là `"5s"`, `retries` hiện là `10`.
- [x] Sửa 2 dòng `healthcheck` của `api` và thêm `expose: ["4100"]` cho `transcoder` như Interfaces.
- [x] Chạy lại lệnh `jq -e` ở bước 1. Expect: exit 0.
- [x] `docker compose config --format json | jq -e '.services.transcoder.expose == ["4100"] and .services.transcoder.ports == null'` — expect exit 0 (không publish ra host).

Exempt: config — verified by docker compose config (jq) + bash scripts/verify-phase0.sh output (bên dưới); không có logic mới, chỉ đổi giá trị healthcheck/expose trong compose.

- [x] (Host, Docker only) `docker compose up -d --build transcoder api`; đợi `api` `healthy`; chạy `docker compose exec -T api curl -fsS http://transcoder:4100/health/gpu` (hoặc lệnh tương đương) — xác nhận reachable trong mạng compose. Paste output.
- [x] Per US1 AC27: chạy lại `bash scripts/verify-phase0.sh` trong cùng commit (không sửa nội dung file — chỉ tái xác nhận DoD-0-1 vẫn xanh sau đổi compose). Paste output.
- [x] Chạy `cmd.lint` (compose không nằm trong phạm vi eslint/prettier nhưng chạy để giữ pipeline nhất quán). Paste output.
- [x] Commit: `chore(compose): tighten api healthcheck timeout/retries, expose transcoder GPU probe port (D8, Q14)`.

Review: ✅ r2

## Task 6: AC5/AC6/AC7/AC10 — `apps/api`: `logger.options.ts`, correlation echo, redact, `AllExceptionsFilter` fallback

Depends on: task 2

**Files**

- Create: `apps/api/src/logger.options.ts`
- Create: `apps/api/src/logger.options.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Create: `apps/api/src/common/filters/all-exceptions.filter.spec.ts`
- Create: `apps/api/test/correlation-id.e2e-spec.ts`

**Interfaces**

- Consumes: `resolveCorrelationId(candidate?: string | null): string`, `LOG_REDACT_CONFIG` (Task 2, import từ `"@myflix/shared"` — barrel, `apps/api` là Node, không có ràng buộc Edge).
- `genReqId(req: IncomingMessage, res: ServerResponse): string` — export riêng (không phải arrow ẩn danh) để test gọi trực tiếp: đọc `req.headers["x-correlation-id"]` (`Array.isArray(raw) ? raw[0] : raw` — xử lý kiểu `string | string[] | undefined` của `IncomingHttpHeaders`), gọi `resolveCorrelationId(...)`, `res.setHeader("X-Correlation-Id", id)` KHÔNG điều kiện, trả `id`. Chữ ký khớp `GenReqId` của `pino-http/index.d.ts` (nhận cả `res`).
- `PINO_HTTP_OPTIONS` — export riêng object:
  ```ts
  export const PINO_HTTP_OPTIONS = {
    genReqId,
    customAttributeKeys: { reqId: "correlationId" }, // mission D9 nguyên văn
    quietReqLogger: true, // NB1 — bắt buộc: customAttributeKeys một mình không đủ (xác minh thực nghiệm design §4)
    redact: LOG_REDACT_CONFIG, // mission D10
  };
  ```
  `apps/api/src/app.module.ts` import `PINO_HTTP_OPTIONS` từ `"./logger.options"`, dùng trong `LoggerModule.forRoot({ pinoHttp: PINO_HTTP_OPTIONS })` — xoá khối `pinoHttp: { genReqId: ..., customProps: ..., redact: [...] }` cũ (2 path, thiếu `set-cookie`) ở `app.module.ts`; xoá import `randomUUID` từ `node:crypto` không còn dùng.
- `AllExceptionsFilter.catch()` — thêm dòng đầu (R3-S4/R4-S3, sau khi lấy `req`/`res`): `if (!req.id) req.id = genReqId(req, res);` — import `{ genReqId } from "../../logger.options"` (đường dẫn tương đối từ `apps/api/src/common/filters/` tới `apps/api/src/logger.options.ts`). Lý do: body-parser lỗi (`next(err)`) bỏ qua middleware `pino-http` nên `genReqId` chưa chạy, `req.id` rỗng — không có fallback thì response 400 thiếu header `X-Correlation-Id`, vi phạm AC6 ("mọi mã HTTP").
- **R4-S2 — harness e2e phải đăng ký `AllExceptionsFilter`**: `beforeAll` của `correlation-id.e2e-spec.ts` [NEW] phải gọi `app.useGlobalFilters(app.get(AllExceptionsFilter))` trước `app.init()` (giống `apps/api/src/main.ts:22`) — `AllExceptionsFilter` không đăng ký bằng `APP_FILTER`, chỉ có trong `AppModule.providers`, nên `app.get(AllExceptionsFilter)` resolve trực tiếp từ `TestingModule` đã compile, không cần provider thêm.
- Route dùng cho case JSON hỏng (R3-S4): `POST /api/auth/login` (`apps/api/src/auth/auth.controller.ts`, `@Public()`, nhận `LoginDto` qua `@Body()`) — route có body, không cần đăng nhập trước.
- `UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` (S5, cùng regex đã dùng ở Task 2's `correlation-id.test.ts`) — khai lại hằng số này ở đầu `logger.options.spec.ts` và `correlation-id.e2e-spec.ts` (2 file test khác nhau, không share module giữa Task 2 và Task 6).
- Case T9 (e2e, ép lỗi 500): `jest.spyOn(app.get(AuthService), "login").mockRejectedValueOnce(new Error("boom"))` (`AuthService` tại `apps/api/src/auth/auth.service.ts`, method `login(dto: LoginDto)`), rồi `POST /api/auth/login` với body `{ email: "t9@example.com", password: "x" }` (khớp `LoginDto`) → assert `500` và response có header `X-Correlation-Id`.

**Steps**

- [x] Failing test 1 (AC5 — echo header): viết `apps/api/src/logger.options.spec.ts` [NEW] — case `genReqId(reqStub, resStub)`: `reqStub = { headers: { "x-correlation-id": "t7-probe-0001" } }`, `resStub = { setHeader: jest.fn() }`; gọi `genReqId(reqStub as never, resStub as never)`; assert `resStub.setHeader` được gọi với `("X-Correlation-Id", "t7-probe-0001")` và hàm trả về `"t7-probe-0001"`. Chạy `pnpm --filter @myflix/api test -- logger.options`. Expect: FAIL — module `./logger.options` chưa tồn tại (`TS2307`).
- [x] Failing test 2 (AC5/NB1/AC10 — pino-http config thật): trong cùng file, dựng harness `pino-http`: `import pinoHttp from "pino-http"`, tạo `memStream` (mảng dòng JSON, `Writable` ghi vào mảng), `pinoHttp({ ...PINO_HTTP_OPTIONS, genReqId: () => "t7-probe-0001" }, memStream)`, chạy 1 request HTTP thật qua `http.createServer` (handler gọi thêm `req.log.info("in-request")` để phủ dòng log phát ra TRONG lúc xử lý, không chỉ `request completed`), gửi request có header `Cookie: refresh_token=t13; pid=p13`, `Authorization: Bearer secret-token`, body JSON `{"password":"T13-Probe-Pass-9"}` (S7 — AC10 đòi "0 dòng mang body", không chỉ header), response `Set-Cookie: refresh_token=rotated`; parse các dòng log JSON từ `memStream`. Assert: (a) MỌI dòng có `correlationId === "t7-probe-0001"`; (b) dòng `request completed` có `req.headers.authorization === "[REDACTED]"`, `req.headers.cookie === "[REDACTED]"`, `res.headers["set-cookie"] === "[REDACTED]"`, và giá trị gốc (`secret-token`, `refresh_token=t13`, `refresh_token=rotated`) không xuất hiện ở đâu trong output; (c) chuỗi `"T13-Probe-Pass-9"` không xuất hiện trong bất kỳ dòng nào của `memStream`, và không dòng nào có khoá `req.body`/`res.body` (pino-http mặc định không log body — assertion này xác nhận không có cấu hình nào lỡ bật nó). Expect: FAIL — `PINO_HTTP_OPTIONS` chưa tồn tại.
- [x] Failing test 3 (R5-N1 — unit test riêng cho fallback của `AllExceptionsFilter`): viết `apps/api/src/common/filters/all-exceptions.filter.spec.ts` [NEW] — dựng `AllExceptionsFilter`, `ArgumentsHost` mock trả `req = { id: undefined, headers: {} }` (chưa qua `genReqId`, mô phỏng đúng lớp lỗi body-parser R3-S4) và `res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() }`; gọi `filter.catch(new BadRequestException("invalid JSON"), host)`; assert `res.setHeader` được gọi với `("X-Correlation-Id", expect.stringMatching(UUID_V4_REGEX))` VÀ `res.json` được gọi với `body.correlationId` bằng đúng giá trị đó (không phải chuỗi rỗng). Chạy `pnpm --filter @myflix/api test -- all-exceptions.filter`. Expect: FAIL — `catch()` hiện tại không gọi `genReqId`/`res.setHeader` khi `req.id` rỗng; `body.correlationId = String(req.id ?? "") = ""`, assertion UUID fail.
- [x] Failing test 4 (AC5/AC10 e2e — S6, viết TRƯỚC khi sửa `app.module.ts`/filter để RED phản ánh đúng `AppModule` thật): viết `apps/api/test/correlation-id.e2e-spec.ts` [NEW] — `beforeAll` import `AppModule` lazily (giống `health.e2e-spec.ts`), compile `TestingModule`, `app.setGlobalPrefix("api")`, **`app.useGlobalFilters(app.get(AllExceptionsFilter))`** (R4-S2, trước `app.init()`), guard `hasInfra` như `health.e2e-spec.ts`. Case T7: `GET /api/health` với header `X-Correlation-Id: t7-probe-0001` → assert response header `x-correlation-id === "t7-probe-0001"`. Case T8: không kèm header → assert response header khớp `UUID_V4_REGEX`. Case T9 (theo Interfaces ở trên): assert `500` và header `X-Correlation-Id` có mặt. Case T10: header dài 65 ký tự → assert response header là UUID v4 mới, KHÔNG bằng giá trị gửi lên. Case R3-S4: `POST /api/auth/login`, `Content-Type: application/json`, body cắt cụt `'{"'` → assert `400` và có header `X-Correlation-Id` khớp `UUID_V4_REGEX`. Chạy `pnpm --filter @myflix/api test:e2e -- correlation-id` (cần infra, `hasInfra` guard skip nếu không có; khi không có infra, ghi rõ trong PR rằng suite tự skip qua `hasInfra` — không phải bằng chứng thiếu). Expect (khi có infra, TRƯỚC mọi bước sửa dưới đây): case T7/T8/T10 FAIL — `AppModule` hiện tại nối `PINO_HTTP_OPTIONS` chưa tồn tại/`app.module.ts` chưa import nó, và filter fallback chưa có nên request lỗi (T9, R3-S4) thiếu header. Đây là RED thật quan sát qua `AppModule` thật, không phải suy đoán "giờ nên PASS" của bản trước.
- [x] Tạo `apps/api/src/logger.options.ts` đúng nội dung ở Interfaces (import `resolveCorrelationId`, `LOG_REDACT_CONFIG` từ `@myflix/shared`).
- [x] Sửa `apps/api/src/app.module.ts`: import `PINO_HTTP_OPTIONS` từ `./logger.options`, thay khối `pinoHttp: {...}` cũ bằng `pinoHttp: PINO_HTTP_OPTIONS`, xoá import `randomUUID` không còn dùng.
- [x] Chạy lại 2 test ở `logger.options.spec.ts`. Expect: PASS.
- [x] Sửa `apps/api/src/common/filters/all-exceptions.filter.ts`: thêm import `{ genReqId } from "../../logger.options"`, thêm dòng fallback `if (!req.id) req.id = genReqId(req, res);` ngay sau khi lấy `req`/`res` trong `catch()`.
- [x] Chạy lại test `all-exceptions.filter.spec.ts`. Expect: PASS.
- [x] Chạy lại `correlation-id.e2e-spec.ts` (nếu có infra). Expect: mọi case PASS.
- [x] Self-review checkpoint: xác nhận `apps/api/src/app.module.ts` không còn định nghĩa `pinoHttp` inline; `PINO_HTTP_OPTIONS` là nguồn DUY NHẤT test AC5/AC10 import (R3-S2 — không dựng literal riêng trong test).
- [x] Chạy `pnpm --filter @myflix/api test`, `pnpm --filter @myflix/api test:e2e` (nếu có infra local), và `cmd.lint`. Paste output vào PR.
- [x] Commit: `feat(api): echo correlationId header on every status, redact 3 headers in logs (D9, D10, R5-N1)`.

Review: ✅ r2

## Task 7: AC9/AC10 — `apps/transcoder`: correlationId job-log context (3 processor) + redact wiring

Depends on: task 2, task 4

**Files**

- Modify: `apps/transcoder/src/jobs/transcode.processor.ts`
- Create: `apps/transcoder/src/jobs/transcode.processor.spec.ts`
- Modify: `apps/transcoder/src/jobs/subtitle.processor.ts`
- Create: `apps/transcoder/src/jobs/subtitle.processor.spec.ts`
- Modify: `apps/transcoder/src/jobs/cleanup.processor.ts`
- Create: `apps/transcoder/src/jobs/cleanup.processor.spec.ts`
- Modify: `apps/transcoder/src/app.module.ts` (thêm `redact: LOG_REDACT_CONFIG` vào `LoggerModule.forRoot`)

**Interfaces**

- Consumes: `resolveCorrelationId(candidate?: string | null): string` (Task 2, từ `@myflix/shared`), `LOG_REDACT_CONFIG` (Task 2), `HealthModule` đã có trong `AppModule.imports` (Task 4 — file `app.module.ts` này Task 4 đã sửa trước).
- Mechanism (D11, design §4, dùng đúng API có ở `nestjs-pino@4.6.1` — KHÔNG có `PinoLogger.runInContext`, chỉ ở 5.x, ngoài phạm vi ticket; `PinoLogger.assign()` cũng không dùng được ngoài request scope): bọc thân mỗi `process()` bằng `storage.run(new Store(PinoLogger.root.child({ correlationId })), fn)`, import `{ storage, Store } from "nestjs-pino/storage"` (deep import hợp lệ — `nestjs-pino/package.json` không có trường `exports`), `import { PinoLogger } from "nestjs-pino"`. Inject `PinoLogger` (constructor param, thay `new Logger(XxxProcessor.name)` built-in); mọi `this.logger.info/warn(...)` (PinoLogger's method — dùng `.info` thay `.log`, `PinoLogger` không có `.log`) phát ra TRONG `storage.run(...)` đều mang `correlationId`, kể cả log từ service khác gọi qua Nest's built-in `Logger` (route qua cùng `PinoLogger.logger` getter, xem `app.useLogger(app.get(Logger))` ở `main.ts`).
- `TranscodeProcessor.process(job)`: `const correlationId = resolveCorrelationId(job.data.correlationId);` rồi `return storage.run(new Store(PinoLogger.root.child({ correlationId })), async () => { ...thân try/catch/finally giữ nguyên, bỏ `correlationId` khỏi từng lệnh log (đã có trong context)... });`. `job.data.correlationId` đã tồn tại sẵn, bắt buộc, `string` trong `TranscodeJobData` (`packages/shared/src/dto/ingest.ts`) — KHÔNG sửa DTO này.
- `SubtitleJobData` (interface local trong `subtitle.processor.ts`, không đưa vào `packages/shared` — chỉ 1 consumer nội bộ): thêm field `correlationId?: string;` (optional — job dọn dẹp/cron không có). Cùng pattern `storage.run(...)` với `resolveCorrelationId(job.data.correlationId)`, inject `PinoLogger` thay `new Logger(SubtitleProcessor.name)` — constructor mới: `constructor(private readonly logger: PinoLogger) { super(); }` (R2-S1 — `SubtitleProcessor extends WorkerHost`, TS bắt buộc gọi `super()` là câu lệnh đầu tiên trong constructor của lớp dẫn xuất, thiếu thì `TS2377`; `WorkerHost` không có constructor tường minh nên `super()` không cần tham số. Hiện tại class không có constructor tường minh nào, chỉ field `private readonly logger = new Logger(...)`).
- **B2 — `SubtitleProcessor` hiện không log gì trước khi throw** (`process()` chỉ `void job;` rồi `throw new Error("SubtitleProcessor.process not implemented")` ngay, không có dòng log nào để quan sát `correlationId`). Thêm đúng 1 dòng `this.logger.info({ assetId: job.data.assetId }, "job started");` ngay đầu thân `process()`, TRƯỚC dòng comment TODO và TRƯỚC `throw` — không đổi hành vi nghiệp vụ (vẫn throw ngay sau), chỉ để lộ bằng chứng cho AC9/B2. Toàn thân `process()` (dòng log mới + `throw`) bọc trong `storage.run(new Store(PinoLogger.root.child({ correlationId })), fn)` như `TranscodeProcessor`.
- `CleanupProcessor.process(_job: Job)`: `job.data` hiện là `{}` (job "drain" của `MaintenanceService` không truyền field nào) → `resolveCorrelationId(undefined)` luôn sinh **1 UUID v4 mới mỗi lần `process()` chạy** (A8/T12b — không phải giá trị cố định toàn cục). Bọc toàn bộ thân hàm hiện có (vòng `for` xoá `deletionQueue`) trong cùng `storage.run(...)`, inject `PinoLogger` thay `new Logger(CleanupProcessor.name)` — constructor mới: `constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly logger: PinoLogger) { super(); }` (thêm `logger` làm tham số thứ 3, cạnh `prisma`/`storage` đã có). Dòng log quan sát được duy nhất trong nhánh test (B2): `this.logger.warn({ err: error, key: row.objectKey }, "object delete failed")` trong nhánh `catch` của vòng `for` — dòng này đã tồn tại sẵn, chỉ đổi từ Nest `Logger` sang `PinoLogger` instance, không đổi message/field.
- `apps/transcoder/src/app.module.ts`: sửa `LoggerModule.forRoot()` (hiện gọi không tham số) thành `LoggerModule.forRoot({ pinoHttp: { redact: LOG_REDACT_CONFIG } })` (mission D10) — import `LOG_REDACT_CONFIG` từ `@myflix/shared`.
- **S8(b) — AC10 phía `transcoder` không có unit test ở Task 7** (không có harness HTTP nào dựng `GpuProbeController` qua `pino-http` thật trong task này — 3 test mới của Task 7 chỉ test processor, không test request/response HTTP). Redact của `transcoder` (`LOG_REDACT_CONFIG` áp cho `pinoHttp` của `app.module.ts`) được verify bằng compose thật ở **Task 9, bước T13** — xem bước đó, đã bổ sung lệnh `curl`/`node -e fetch` gửi header `Authorization` tới `GET /health/gpu` và `docker compose logs transcoder` xác nhận `[REDACTED]`.
- **NS1 — harness bắt buộc cho test (xem Steps)**: `PinoLogger.root` chỉ được gán khi Nest gọi `configure()` lúc `app.init()`/`app.listen()` thật — một test dựng `processor` bằng mock thủ công sẽ thấy `PinoLogger.root === undefined`. Dựng lại bằng `pino-http` (dependency trực tiếp có sẵn ở `transcoder`), KHÔNG `import pino from "pino"` (không phải dependency trực tiếp — `require.resolve('pino')` từ `apps/transcoder/src` MISSING). Harness này lặp lại giống hệt (deep-import `__resetOutOfContextForTests`, `new PinoLogger({ pinoHttp: [{}, memStream] })`, gán `PinoLogger.root`) ở cả 3 file spec mới của Task 7 (`transcode.processor.spec.ts`, `subtitle.processor.spec.ts`, `cleanup.processor.spec.ts`) — mỗi file dựng `memStream` riêng của nó trong `beforeEach`.
- `UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` (R2-B1, chép nguyên văn từ nguồn gốc: Task 2's `correlation-id.test.ts` case `resolveCorrelationId(undefined)`, cùng hằng số đã đặt tên ở Task 6's Interfaces — S5). Khai lại hằng số này ở đầu cả 3 file spec mới của task này (`transcode.processor.spec.ts`, `subtitle.processor.spec.ts`, `cleanup.processor.spec.ts`).

**Steps**

- [x] Failing test 1 (AC9 — `TranscodeProcessor`): viết `apps/transcoder/src/jobs/transcode.processor.spec.ts` [NEW]. `beforeEach`: dựng `memStream` (mảng dòng JSON, ghi qua stream ghi được), gọi `__resetOutOfContextForTests()` (deep-import `nestjs-pino/PinoLogger`, hợp lệ vì package không có `exports`), `new PinoLogger({ pinoHttp: [{}, memStream] })` (gán lại `outOfContext`), rồi `(PinoLogger as unknown as { root: ... }).root = pinoHttp({}, memStream).logger;` (gán `root` trỏ cùng `memStream` — KHÔNG dựng `NestApplication`/`Test.createTestingModule().compile()`, `compile()` không gọi `configure()`). Dựng `processor = new TranscodeProcessor(prismaMock, storageMock, ffmpegMock, keyframesMock, eventsMock, configMock, new PinoLogger({ pinoHttp: [{}, memStream] }))` (inject `PinoLogger` — constructor đã đổi ở bước implement, nhưng viết test TRƯỚC theo chữ ký MỚI để RED phản ánh đúng thiếu implementation). Case 1 (AC9 chính): `storageMock = { buckets: { staging: "myflix-staging" }, deletePrefix: jest.fn().mockRejectedValue(new Error("x")) }` (R2-S2 — `finally` đọc `this.storage.buckets.staging` TRƯỚC khi gọi `deletePrefix`, thiếu `buckets` thì `finally` ném `TypeError` và không bao giờ có dòng "staging cleanup failed"/"job finished", test đỏ vĩnh viễn vì lý do sai); `prismaMock` và `eventsMock` để `{}` (chấp nhận được — `mark()`/`fail()` ném lỗi trong `try`/`catch` không cản 3 dòng log cần assert); `fakeJob = { data: { assetId: "a1", jobId: "j1", correlationId: "t12-probe-0001" } }`; gọi `await processor.process(fakeJob).catch(() => {})` (job fail ở bước chưa implement — chấp nhận được); trước tiên assert `logs.length >= 3` (R3-S1 — tránh assertion sau vô nghĩa khi rỗng) và chứa đủ 3 message `"job started"`, `"staging cleanup failed"`, `"job finished"`; rồi assert MỌI dòng trong `logs` (kể cả dòng `warn` trong `finally`) mang `correlationId === "t12-probe-0001"`. Case 2 (T12b): `fakeJob.data` không có `correlationId` (cast `fakeJob as unknown as Job<TranscodeJobData>` — `TranscodeJobData.correlationId` là `string` bắt buộc, không optional, nên object thiếu field này không tự khớp type) → assert mọi dòng log của lần chạy đó mang CÙNG 1 giá trị, và giá trị đó khớp regex UUID v4. Chạy `pnpm --filter @myflix/transcoder test -- transcode.processor`. Expect: FAIL — constructor hiện tại nhận `ConfigService` làm tham số cuối, không có `PinoLogger`; TS compile lỗi thừa/thiếu tham số (`TS2554`).
- [x] Failing test 2 (B2 — `SubtitleProcessor`): viết `apps/transcoder/src/jobs/subtitle.processor.spec.ts` [NEW] — cùng harness `memStream`/`__resetOutOfContextForTests`/`PinoLogger.root` (NS1) trong `beforeEach` riêng của file này. Dựng `processor = new SubtitleProcessor(new PinoLogger({ pinoHttp: [{}, memStream] }))` (constructor mới nhận `PinoLogger`). `fakeJob = { data: { assetId: "a1", subtitleTrackId: "st1", sourceKey: "raw/a1.srt", lang: "vi", correlationId: "t12-probe-0002" } }`; gọi `await processor.process(fakeJob).catch(() => {})` (vẫn throw "not implemented" — chấp nhận được). Assert `logs.length >= 1` (tránh assertion sau vô nghĩa khi rỗng) và dòng đầu có `msg`/`message` chứa `"job started"`; assert dòng đó mang `correlationId === "t12-probe-0002"`. Chạy `pnpm --filter @myflix/transcoder test -- subtitle.processor`. Expect: FAIL — `SubtitleProcessor` hiện không có constructor nhận tham số nào (`TS2554`, thừa tham số) VÀ không có dòng log nào trước `throw` (`logs.length` sẽ luôn là 0 kể cả sau khi sửa xong constructor nhưng chưa thêm dòng `this.logger.info(...)`) — RED hành vi thật, không chỉ lỗi compile.
- [x] Failing test 3 (B2 — `CleanupProcessor`, T12b thuộc đúng class này): viết `apps/transcoder/src/jobs/cleanup.processor.spec.ts` [NEW] — cùng harness NS1 trong `beforeEach` riêng của file này. `prismaMock.deletionQueue.findMany` trả `[{ id: "d1", bucket: "myflix-media", objectKey: "obj1", isPrefix: false, createdAt: new Date() }]`; `prismaMock.deletionQueue.update` resolve; `storageMock.deleteObjects` reject với `Error("delete failed")` (sinh nhánh `catch` → dòng `warn` "object delete failed"). Dựng `processor = new CleanupProcessor(prismaMock, storageMock, new PinoLogger({ pinoHttp: [{}, memStream] }))` (constructor thêm tham số `PinoLogger` thứ 3). Gọi `await processor.process({} as Job)` (chữ ký hiện tại bỏ qua `job`, luôn `resolveCorrelationId(undefined)`). Assert `logs.length >= 1`, dòng cuối có `msg`/`message` chứa `"object delete failed"`, `correlationId` khớp `UUID_V4_REGEX` (định nghĩa lại hằng số này trong file, cùng giá trị đã dùng ở Task 2/Task 6). Reset `memStream` (hoặc ghi lại độ dài mảng trước/sau) rồi gọi `process({} as Job)` LẦN THỨ HAI với cùng mock → assert `correlationId` của lần 2 KHÁC lần 1 (T12b — mỗi lần chạy sinh 1 UUID mới, không phải giá trị cố định). Chạy `pnpm --filter @myflix/transcoder test -- cleanup.processor`. Expect: FAIL — constructor hiện tại chỉ nhận `(prisma, storage)`, thêm tham số thứ 3 gây `TS2554`; sau khi sửa constructor nhưng CHƯA bọc `storage.run`, dòng `warn` "object delete failed" chạy ngoài context → không mang `correlationId` → assertion đầu tiên fail — RED hành vi thật.
- [x] Sửa `TranscodeProcessor`: đổi tham số cuối constructor từ ngầm định (`private readonly logger = new Logger(...)`) sang inject `PinoLogger` (tham số constructor), VÀ đổi cả 2 lệnh gọi `this.logger.log(...)` ("job started", "job finished") thành `this.logger.info(...)` trong cùng bước này (S8(a) — `PinoLogger@4.6.1` không có method `.log`, chỉ có `trace/debug/info/warn/error/fatal`; nếu để nguyên `.log` thì bước này không biên dịch được, `TS2339`) — **CHƯA bọc `storage.run`**.
- [x] Chạy lại test 1. Expect: FAIL (S8 — RED hành vi thật, khác RED ở bước trước): compile sạch (nhờ đã đổi `.log` → `.info` ở bước trên), nhưng dòng `this.logger.warn(...)` trong `finally` ("staging cleanup failed") vẫn chạy ngoài mọi context → không mang `correlationId` → assertion "mọi dòng mang t12-probe-0001" fail. Paste output vào PR làm bằng chứng RED hành vi (không phải RED biên dịch).
- [x] Bọc thân `process()` của `TranscodeProcessor` bằng `storage.run(new Store(PinoLogger.root.child({ correlationId })), fn)` như Interfaces.
- [x] Chạy lại test 1. Expect: cả 2 case PASS.
- [x] Sửa `SubtitleProcessor`: thêm field `correlationId?: string` vào `SubtitleJobData`, đổi sang constructor tường minh inject `PinoLogger`, thêm dòng `this.logger.info({ assetId: job.data.assetId }, "job started");` đầu thân `process()` (B2), bọc toàn thân (dòng log + `throw`) cùng pattern `storage.run(...)`.
- [x] Chạy lại test 2. Expect: PASS.
- [x] Sửa `CleanupProcessor`: inject `PinoLogger` (thêm vào constructor có sẵn, cạnh `prisma`/`storage`), bọc toàn bộ thân `process()` (vòng `for`) trong `storage.run(...)`.
- [x] Chạy lại test 3. Expect: PASS (cả 2 lần gọi `process()`, 2 UUID khác nhau).
- [x] Sửa `apps/transcoder/src/app.module.ts`: thêm `redact: LOG_REDACT_CONFIG` vào `LoggerModule.forRoot({ pinoHttp: {...} })`, import `LOG_REDACT_CONFIG` từ `@myflix/shared`.
- [x] Self-review checkpoint: xác nhận cả 3 processor không còn `new Logger(XxxProcessor.name)` từ `@nestjs/common`; `SubtitleJobData.correlationId` là optional (không phá vỡ nơi khác chưa truyền field này — hiện chưa ai gọi `.add()` thật cho `QUEUE_SUBTITLE`, xem OPEN(BA)); nhắc lại AC10 phía `transcoder` (redact) được verify ở Task 9 T13, không phải ở đây (S8(b)).
- [x] Chạy `pnpm --filter @myflix/transcoder test` (scoped) và `cmd.lint`. Paste output vào PR.
- [x] Commit: `feat(transcoder): propagate correlationId through job logs via storage.run + PinoLogger.root.child (D11), redact headers (D10)`.

Review: ✅ r1

## Task 8: AC8 — `apps/web`: forward `correlationId` khi render phía server

Depends on: task 2

**Files**

- Modify: `apps/web/src/middleware.ts`
- Modify: `apps/web/src/middleware.test.ts`
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/lib/api-client.test.ts`
- Create (contingency, chỉ nếu `pnpm --filter web build` đỏ — xem Steps): `apps/web/src/lib/api-server.ts`
- Modify (contingency, chỉ nếu `pnpm --filter web build` đỏ — S11): `apps/web/src/app/(viewer)/browse/page.tsx`
- Modify (contingency, chỉ nếu `pnpm --filter web build` đỏ — S11): `apps/web/src/components/browse/title-detail.tsx`

**Interfaces**

- Consumes: `resolveCorrelationId(candidate?: string | null): string` — import từ subpath `"@myflix/shared/correlation-id"` (Task 2), KHÔNG từ barrel `"@myflix/shared"` (barrel re-export `./password` → `@node-rs/argon2`, native addon không chạy trên Edge Runtime — `middleware.ts` chạy Edge mặc định, không có `export const runtime = "nodejs"`).
- `middleware.ts`: thêm `const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));` ngay sau khi lấy `pathname`; dòng `logger.info(...)` hiện có thêm field `correlationId`. **S9 — chỉ dòng `return` CUỐI hàm forward header, 2 nhánh redirect giữ nguyên `NextResponse.redirect(...)` không đổi** (KHÔNG phải "trước mọi return kể cả redirect" — trình duyệt tự issue request mới theo `Location` khi redirect, không cần forward header vào response redirect đó): `const forwardedHeaders = new Headers(request.headers); forwardedHeaders.set("x-correlation-id", correlationId); return NextResponse.next({ request: { headers: forwardedHeaders } });` thay cho `return NextResponse.next();` ở cuối hàm.
- `NextResponse.next({request:{headers}})` set `x-middleware-request-<key>` + `x-middleware-override-headers` trên response — cơ chế Next.js dùng để dựng lại request tới Server Component; `headers()` (từ `next/headers`) đọc lại được.
- `api-client.ts`: thêm hàm `resolveServerCorrelationId(): Promise<string | undefined>` — `if (typeof window !== "undefined") return undefined;` (browser: nginx route thẳng tới `api`, không cần header này); `try { const { headers } = await import("next/headers"); return (await headers()).get("x-correlation-id") ?? undefined; } catch { return undefined; }` (dynamic import — giữ `next/headers` ngoài client bundle; ngoài request scope thì `headers()` ném lỗi, không phải bug). `apiFetch` gọi `const correlationId = await resolveServerCorrelationId();` đầu hàm, thêm `...(correlationId ? { "X-Correlation-Id": correlationId } : {})` vào `headers` object hiện có (trước `...init.headers` để caller override được nếu cần).
- Header tên chính xác gửi lên `api`: `X-Correlation-Id` (khớp `genReqId` phía `api` đọc `x-correlation-id`, header HTTP không phân biệt hoa/thường).
- **S7 — bằng chứng bắt buộc**: `apps/web/src/components/player/player-shell.tsx` (`"use client"`) import `apiFetch` từ `api-client.ts`, nên file này nằm trong graph CLIENT dù guard `typeof window` chỉ có tác dụng runtime — `pnpm --filter web build` phải xanh, chứng minh Edge bundle của `middleware.ts` không kéo `@node-rs/argon2` VÀ client bundle (qua `player-shell.tsx`) không kéo `next/headers`. Nếu build đỏ (không tree-shake được `import("next/headers")` khỏi bundle client): tách `apps/web/src/lib/api-server.ts` [NEW, contingency] chỉ chứa `resolveServerCorrelationId` + import `next/headers`, chỉ được import bởi Server Component/route handler; `api-client.ts` (import được từ cả client lẫn server) không đụng `next/headers` nữa — gọi qua tham số `correlationId?: string` truyền từ caller server-side, hoặc bỏ default ở nhánh client-safe. **S11 — caller server-side cụ thể** (nhánh dự phòng này SỬA CALLER, không chỉ tách file mới): `apps/web/src/app/(viewer)/browse/page.tsx` và `apps/web/src/components/browse/title-detail.tsx` (đọc trực tiếp session này — cả 2 file KHÔNG có `"use client"`, tức Server Component, và cả 2 import `apiFetch` từ `@/lib/api-client`) đổi import sang `apiFetch` của `apps/web/src/lib/api-server.ts` mới; `apps/web/src/components/player/player-shell.tsx` (`"use client"`, cũng import `apiFetch`) GIỮ NGUYÊN import từ `api-client.ts` — đây chính là file buộc `api-client.ts` phải sạch `next/headers` (S7). Thêm 2 file server-side vào **Files** của task này dưới dạng "Modify (contingency, chỉ khi `pnpm --filter web build` đỏ)".
- `apps/web/src/lib/logger.ts`: KHÔNG đổi (Finding 10 của design — `pino/browser.js` không hỗ trợ `redact`; D10 không áp cho `web` ở file này, ghi nhận là giới hạn kỹ thuật, không phải thiếu sót).
- **S10 — AC8/AC10 phía `web` cần assert đúng vế log, không chỉ header forward**: middleware case (Failing test 1) phải parse dòng log JSON (`console.log` spy, giống 3 test hiện có ở `middleware.test.ts`) và assert `parsed.correlationId` bằng đúng giá trị đã forward — vế lõi của AC8 ("log `web` ghi cùng `correlationId`"), không chỉ kiểm header response. Cùng case đó assert dòng log KHÔNG chứa `refresh_token=t`/`pid=p` (AC10 phía `web`, dù `logger.ts` không đổi — dòng log middleware hiện tại chỉ có `msg/method/path/level`, không log cookie, nên assertion này xác nhận không có hồi quy vô tình thêm cookie vào log khi sửa middleware).
- `UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` (R2-B1, chép nguyên văn từ nguồn gốc: Task 2's `correlation-id.test.ts` case `resolveCorrelationId(undefined)`, cùng hằng số đã đặt tên ở Task 6/Task 7's Interfaces — S5). Khai lại hằng số này ở đầu `middleware.test.ts`.

**Steps**

- [x] Failing test 1 (AC8/AC10 middleware — S9/S10): sửa `apps/web/src/middleware.test.ts` — thêm case: request KÈM `cookie: "refresh_token=t; pid=p"` (S9 — bắt buộc, nếu không có cookie thì request đi nhánh redirect `/login` và không bao giờ chạm dòng `return` cuối hàm bị sửa, test luôn đỏ dù đã implement xong) và header `X-Correlation-Id: t11-probe-0001`, gọi `middleware(request)`; assert `response.headers.get("x-middleware-request-x-correlation-id") === "t11-probe-0001"`; parse dòng log JSON (`console.log` spy như 3 test hiện có) và assert `parsed.correlationId === "t11-probe-0001"` (S10) VÀ dòng log đó không chứa chuỗi `refresh_token=t`/`pid=p` (S10, AC10). Thêm case thứ hai: cùng cookie, KHÔNG kèm header `X-Correlation-Id` → assert `response.headers.get("x-middleware-request-x-correlation-id")` khớp `UUID_V4_REGEX` (cùng hằng số đã dùng ở Task 2/6/7) VÀ `parsed.correlationId` khớp cùng regex đó. Chạy `pnpm --filter web test -- middleware`. Expect: FAIL — `middleware.ts` hiện tại chỉ redirect/`NextResponse.next()` trơn, không set header nào vào request forward (`x-middleware-request-x-correlation-id` là `null`) và dòng log không có field `correlationId` nào (`parsed.correlationId === undefined`).
- [x] Failing test 2 (AC8 api-client): sửa `apps/web/src/lib/api-client.test.ts` — thêm case: `vi.mock("next/headers", () => ({ headers: async () => new Map([["x-correlation-id", "t11-probe-0001"]]) }))` (hoặc `Headers`-shape mock khớp `.get()`), stub `fetch`, gọi `apiFetch("/x")`, assert `fetch` được gọi với `headers` chứa `"X-Correlation-Id": "t11-probe-0001"`. Chạy `pnpm --filter web test -- api-client`. Expect: FAIL — `resolveServerCorrelationId` chưa tồn tại, `apiFetch` không gửi header đó.
- [x] Sửa `middleware.ts` theo Interfaces (import subpath `@myflix/shared/correlation-id`).
- [x] Sửa `api-client.ts` theo Interfaces.
- [x] Chạy lại `pnpm --filter web test`. Expect: PASS.
- [x] Chạy `pnpm --filter web build`. Nếu PASS: xong, bỏ qua bước contingency dưới. Nếu FAIL (không tree-shake được `next/headers` khỏi client bundle qua `player-shell.tsx` → `api-client.ts`): tách `apps/web/src/lib/api-server.ts` như Interfaces mô tả; đổi import `apiFetch` ở đúng 2 caller server-side (S11) — `apps/web/src/app/(viewer)/browse/page.tsx` và `apps/web/src/components/browse/title-detail.tsx` — sang `api-server.ts`; `player-shell.tsx` (`"use client"`) GIỮ NGUYÊN import từ `api-client.ts`; `api-client.ts` bỏ `next/headers`/`resolveServerCorrelationId`, nhận `correlationId?: string` qua tham số thay vào đó; chạy lại `pnpm --filter web test` và `pnpm --filter web build` tới khi cả hai xanh.
- [x] Self-review checkpoint: xác nhận `middleware.ts` KHÔNG import `@myflix/shared` (barrel) — chỉ `@myflix/shared/correlation-id`; `logger.ts` không đổi.
- [x] Chạy `pnpm --filter web test` (scoped), `pnpm --filter web build`, và `cmd.lint`. Paste cả 3 output vào PR.
- [x] Commit: `feat(web): forward correlationId to api during SSR (AC8)`.

Review: ✅ r2

## Task 9: Closing — full verification

Depends on: task 1, task 2, task 3, task 4, task 5, task 6, task 7, task 8, task 10, task 11, task 12, task 13, task 14, task 15, task 16

**Files**

- Test: `docker-compose.yml`, `scripts/verify-phase0.sh`, `apps/api/test/health.e2e-spec.ts`, `apps/api/test/correlation-id.e2e-spec.ts`, `apps/transcoder/src/jobs/transcode.processor.spec.ts` (read-only re-run — task này không sửa production code; nếu một bước dưới phát hiện hồi quy, việc sửa thuộc lại task tương ứng ở trên, không phải task này)

**Interfaces**

- Consumes: mọi Interface được 8 task trên produce — không có gì mới được produce bởi task này.

**Steps**

- [x] Chạy full `cmd.test`: `pnpm -r test`. Paste output đầy đủ vào PR.
- [x] Chạy full `cmd.lint`: `npx eslint . && npx prettier --check .`. Paste output vào PR.
- [x] Chạy `pnpm --filter web build` (AC8 Edge bundle — bằng chứng đóng, dù Task 8 đã chạy riêng). Paste output.
- [x] Chạy `pnpm -r build` (toàn repo, xác nhận `@nestjs/platform-express` mới ở `transcoder` không phá build service khác).
- [x] (Host, Docker only, live stack) `docker compose up -d --build --wait --wait-timeout 180`. Xác nhận 7 service `healthy`.
- [x] T1: `curl -s -o body.json -w '%{http_code}' http://<lan-ip>/api/health` (không kèm `Authorization`) → `200`; `body.json` có đủ `postgres/redis/minio/gpu`, mỗi cái `"ok"` (hoặc `"not_required"` cho `gpu` trên nhánh CPU).
- [x] T2/T2b: `docker compose stop redis` → gọi lại như T1 → `503`, `checks.redis === "fail"`, 3 cái còn lại sống; `docker compose start redis`, đợi `healthy`, gọi lại → `200`.
- [x] T3/T3b: lặp T2 cho `postgres`, `minio`; rồi dừng `redis` + `minio` cùng lúc → `503`, đánh dấu đúng cả hai, `postgres`/`gpu` báo sống.
- [x] T4/T4b: làm GPU không truy cập được (cách do Dev chọn) hoặc `docker compose stop transcoder` → gọi như T1 → `503`; T4b: `checks.gpu` mang trạng thái riêng `"unreachable"` (khác `"down"`), 3 phụ thuộc kia sống; `docker compose start transcoder`.
- [x] T4c: dựng bằng `docker-compose.cpu.yml` (nếu môi trường có sẵn override này theo US1 AC26) → `200`, `checks.gpu === "not_required"`.
- [x] T5: `docker compose pause redis`; `curl -w '%{time_total}'` → `503`, `time_total ≤ 1.5`; `docker compose unpause redis`.
- [x] T6: lấy body của T1 và T2, `grep` tìm `redis://`, `postgres://`, `:5432`, `:6379`, `:9000`, giá trị `S3_SECRET_KEY`, `POSTGRES_PASSWORD`, `ECONNREFUSED` → 0 kết quả.
- [x] T7–T10: đã chạy ở Task 6's `correlation-id.e2e-spec.ts`; chạy lại 1 lần qua stack thật (`docker compose logs api | grep t7-probe-0001` v.v.) để xác nhận log Docker thật (không chỉ Jest supertest) mang đúng `correlationId`.
- [x] T11: mở 1 trang có SSR với `X-Correlation-Id: t11-probe-0001`; `docker compose logs web api | grep t11-probe-0001` → cả 2 service có dòng log mang giá trị đó.
- [x] T12: nếu ticket ingest Phase 1 đã hiện thực enqueue thật tính tới thời điểm merge — chạy T12 theo văn bản; nếu chưa (theo OPEN(BA) hiện tại) — ghi rõ trong PR là T12 được thay bằng bằng chứng `transcode.processor.spec.ts` ở Task 7, dẫn link.
- [x] T12b: kích hoạt job dọn dẹp theo lịch (hoặc đợi `MaintenanceService` cron tự chạy) → `docker compose logs transcoder | grep <uuid quan sát được>` → mọi dòng mang cùng 1 `correlationId`.
- [x] T13: đăng nhập bằng tài khoản thử `T13-Probe-Pass-9`; tìm mật khẩu, access token, `refresh_token` trong log 3 service → 0 kết quả; đếm dòng log có trường `body` → 0; xác nhận header nhạy cảm hiện `[REDACTED]`. **S8(b) — bổ sung riêng cho `transcoder`** (không có unit test HTTP nào ở Task 7 phủ redact của `transcoder`): `docker compose exec -T api node -e "fetch('http://transcoder:4100/health/gpu',{headers:{authorization:'Bearer t13-secret'}}).then(()=>{})"`; sau đó `docker compose logs transcoder | grep -c t13-secret` → `0`, `docker compose logs transcoder | grep -c '\[REDACTED\]'` → `>=1`.
- [x] T14: `docker compose logs api web transcoder --no-log-prefix | jq -c . > /dev/null` → thoát mã 0.
- [x] Per US1 AC27 (đã chạy ở Task 5, chạy lại lần cuối ở đây để xác nhận không hồi quy sau các task khác): `bash scripts/verify-phase0.sh` → DoD-0-1 PASS (7 service healthy cả nhánh GPU lẫn CPU nếu test được cả hai).
- [x] `docker compose down`.
- [x] Commit: `chore: final verification for M-platform-operations-US2 (health check + correlation ID)` (nếu có thay đổi cần commit — nếu không, bỏ qua bước commit và ghi trong PR rằng Task 9 chỉ verify).

Review: ✅ verified (full run at Task 12 HEAD; T2/T5/T14 rerun at Task 13 HEAD; T1/T2/T5/T10/T14 + NFR rows 1 & 4 + api e2e live rerun at Task 14 HEAD; verify-phase0 + T13 at c888784; T1/T2/T3/T5/T14 + api e2e + verify-phase0 rerun at Task 16 HEAD — all PASS)

## Amendment 1 (Dev-directed, 2026-09-29) — A3/Task 9 findings the Dev chose to apply

> Nguồn: `docs/impl/M-platform-operations-US2-review/dev-decisions.md`. Dev chọn (b) "apply" cho cả 5 mục: Task 3 S3/S4 → Task 10; Task 4 S2 (+ spec tối thiểu, phủ luôn S1) → Task 11; Task 9 T14 → Task 12. Task 3/4 chỉ tick sau khi Task 10/11 qua A3; Task 9 chạy lại T1/T4/T4b/T5/T14 sau khi 3 task này merge.

## Task 10: AC2/AC3 — `apps/api`: `probeGpu` abort fetch thua timeout + khôi phục citation 503 (A3 Task 3 S3, S4)

Depends on: task 3

**Files**

- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.controller.spec.ts`

**Interfaces**

- Consumes: `CHECK_TIMEOUT_MS = 1_000` (mission D8, đã có trong file), `TRANSCODER_GPU_URL` (mission D7, đã có).
- Produces: không có interface mới. Hai thay đổi trong `health.controller.ts`:
  1. S3 — thêm lại doc comment trên class `HealthController`: `/** Docker healthcheck target. 503 when postgres/redis/minio fail or gpu is down/unreachable (API spec §12, mission D7). */` — comment-only, không đổi hành vi.
  2. S4 — trong `probeGpu()`, dòng `const res = await fetch(TRANSCODER_GPU_URL);` đổi thành `const res = await fetch(TRANSCODER_GPU_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) }); // mission D8 — huỷ request thua withTimeout, không để socket treo tới timeout mặc định của undici`. `withTimeout()` giữ nguyên (vẫn là nguồn của kết quả `"unreachable"` — `AbortSignal.timeout` chỉ dọn socket).
- Không thêm dependency, không đổi contract body/status.

**Steps**

- [x] Failing test: thêm case vào `describe("AC3 …")` của `health.controller.spec.ts`: dựng controller với mọi phụ thuộc healthy, `global.fetch = jest.fn().mockResolvedValue(<200 {gpu:"ok"}>)`, gọi `check()`, assert `fetch` được gọi với `(TRANSCODER_GPU_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }))` và `signal.aborted === false` ngay sau khi gọi. Chạy `pnpm --filter @myflix/api test -- health.controller`. Expect: FAIL — `fetch` hiện được gọi với 1 tham số, `expect.objectContaining` không khớp `undefined`.
- [x] Sửa `health.controller.ts` đúng 2 điểm ở Interfaces.
- [x] Chạy lại `pnpm --filter @myflix/api test -- health.controller`. Expect: PASS — toàn bộ spec (cũ + mới) xanh; case "marks gpu unreachable when the transcoder probe hangs" vẫn xanh (fake timers không can thiệp `AbortSignal.timeout`, `withTimeout` vẫn quyết định kết quả).
- [x] Self-review checkpoint: không đổi giá trị `CHECK_TIMEOUT_MS`; comment citation có mặt ở cả class header lẫn dòng `signal`.
- [x] Chạy `pnpm --filter @myflix/api test` (scoped) và `cmd.lint`. Paste output vào PR.
- [x] Commit: `fix(api): abort losing gpu probe fetch, restore 503 citation on HealthController (A3 S3, S4)`.

Review: ✅ r2

## Task 11: AC1/AC2 — `apps/transcoder`: `GpuProbeService` in-flight guard + spec tối thiểu (A3 Task 4 S2, phủ S1)

Depends on: task 4

**Files**

- Create: `apps/transcoder/src/health/gpu-probe.service.spec.ts`
- Modify: `apps/transcoder/src/health/gpu-probe.service.ts`

**Interfaces**

- Consumes: `GPU_CHECK_INTERVAL_MS = 10_000`, `GPU_STALE_MS = 30_000` (mission D7, đã có), `execFileAsync("nvidia-smi", ["-L"], { timeout: 5_000 })` (đã có).
- Produces: không có interface mới. Thay đổi trong `gpu-probe.service.ts`: thêm field `private inFlight = false;` và ở đầu `runCheck()`: `if (this.inFlight) return; // A3 S2 — một nvidia-smi treo (D-state) không bị SIGKILL, không cho vòng 10s dồn tiến trình` rồi `this.inFlight = true;`; trong `finally` thêm `this.inFlight = false;` (cạnh `this.lastCheckedAt = Date.now();`). `read()` giữ nguyên.
- Spec tối thiểu (thiết kế §10 vẫn coi compose T4/T4b/T4c là bằng chứng tích hợp; spec này chỉ phủ nhánh logic thuần): `jest.mock("node:child_process")` để `execFile` là mock tự gọi callback (thành công / lỗi / treo — không gọi callback cho tới khi test resolve thủ công); `jest.spyOn(Date, "now")` cho ngưỡng stale. Gọi `runCheck()` qua `(service as unknown as { runCheck(): Promise<void> }).runCheck()`; KHÔNG test `onModuleInit`/`setInterval` (giữ quyết định Finding 13).

**Steps**

- [x] Failing test: viết `gpu-probe.service.spec.ts` với 4 case: (1) `read()` là `false` trước mọi lần check; (2) sau `runCheck()` thành công → `read()` `true`; (3) sau `runCheck()` lỗi → `false`; (4) **S2** — khi lần `runCheck()` đầu còn treo (callback chưa gọi), gọi `runCheck()` lần hai → `execFile` mock chỉ được gọi **1** lần; sau khi resolve lần đầu, gọi lần ba → 2 lần. Thêm case (5): sau thành công, `Date.now` tiến `GPU_STALE_MS + 1` → `read()` `false`. Chạy `pnpm --filter @myflix/transcoder test -- gpu-probe.service`. Expect: FAIL — case (4) báo `execFile` được gọi 2 lần (chưa có guard); các case khác có thể pass.
- [x] Thêm `inFlight` vào `gpu-probe.service.ts` đúng như Interfaces.
- [x] Chạy lại `pnpm --filter @myflix/transcoder test -- gpu-probe.service`. Expect: PASS 5/5.
- [x] Self-review checkpoint: `lastCheckedAt` vẫn được set trong `finally` mọi nhánh; guard không đổi hành vi khi không có lệnh treo.
- [x] Chạy `pnpm --filter @myflix/transcoder test` (scoped), `pnpm --filter @myflix/transcoder build`, và `cmd.lint`. Paste output vào PR.
- [x] Commit: `fix(transcoder): guard GpuProbeService.runCheck against overlapping nvidia-smi runs (A3 S2)`.

Review: ✅ r1

## Task 12: AC10 — `api` + `transcoder`: ioredis `error` listener qua Pino (Task 9 T14)

Depends on: none

**Files**

- Modify: `apps/api/src/redis/redis.module.ts`
- Create: `apps/api/src/redis/redis.module.spec.ts`
- Modify: `apps/transcoder/src/redis.module.ts`
- Create: `apps/transcoder/src/redis.module.spec.ts`

**Interfaces**

- Consumes: `Logger` từ `@nestjs/common` (static logger; cả hai app đã `app.useLogger(app.get(Logger))` của `nestjs-pino` trong `main.ts`, nên `new Logger("Redis").error(...)` ra JSON qua Pino — không import `nestjs-pino` vào module này).
- Produces: trong mỗi file, export thêm `export const createRedisClient = (config: ConfigService): Redis => { const client = new Redis({ host: …, port: …, maxRetriesPerRequest: null }); client.on("error", (err: Error) => new Logger("Redis").error(err.message)); // T14 / mission D10 — không có listener thì ioredis in "[ioredis] Unhandled error event" thẳng ra stdout, phá "mọi dòng log là JSON"\n  return client; };` và các provider `useFactory` dùng `createRedisClient` (api: cả `REDIS` lẫn `REDIS_SUBSCRIBER`). Không đổi tên provider/token, không đổi option.
- Nguyên nhân gốc (Task 9 report): `new Redis(...)` ở 2 module này không có listener `error`; ioredis (`Redis.js:553`) `console.error` khi thiếu. BullMQ tự gắn listener trên connection riêng của nó — không phải nguồn.

**Steps**

- [x] Failing test: viết 2 spec giống nhau (mỗi app một file): `jest.mock("ioredis", () => ({ __esModule: true, default: class extends EventEmitter { constructor(public opts: unknown) { super(); } } }))`, `const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)`, dựng `createRedisClient({ getOrThrow: (k) => ({ REDIS_HOST: "redis", REDIS_PORT: 6379 })[k] } as never)`, `client.emit("error", new Error("ECONNREFUSED"))` → assert không throw và `errorSpy` được gọi với `"ECONNREFUSED"`. Chạy `pnpm --filter @myflix/api test -- redis.module` và `pnpm --filter @myflix/transcoder test -- redis.module`. Expect: FAIL — `createRedisClient` chưa export (`TS2305`).
- [x] Sửa 2 `redis.module.ts` đúng như Interfaces.
- [x] Chạy lại 2 lệnh test. Expect: PASS.
- [x] Self-review checkpoint: `maxRetriesPerRequest: null` giữ nguyên; `health.controller.ts` (`@Inject(REDIS)`) và `job-events.publisher.ts` không cần sửa (token không đổi).
- [x] Chạy `pnpm --filter @myflix/api test`, `pnpm --filter @myflix/transcoder test` (scoped) và `cmd.lint`. Paste output vào PR.
- [x] Commit: `fix: route ioredis error events through the Pino logger in api and transcoder (T14)`.

Review: ✅ r1

## Amendment 2 (Dev-directed, 2026-09-29) — Task 9 T14 rerun: BullMQ Queue/Worker `error` không có listener

> Task 12 sửa đúng 2 client ioredis của `RedisModule`; T14 chạy lại vẫn FAIL vì `bullmq` `QueueBase.emit("error")` (`queue-base.js:90-101`) `console.error(err)` (stack trace thô, nhiều dòng) khi `Queue`/`Worker` không có listener `error` — mỗi `BullModule.registerQueue` tạo 1 `Queue`, mỗi `@Processor` tạo 1 `Worker`, đều tự nối connection riêng. Task 9 rerun đếm 38 dòng từ `api`, 25 từ `transcoder`. Cùng gốc T14 (Dev đã duyệt "apply"), nên nối tiếp bằng Task 13.

## Task 13: AC10 — `api` + `transcoder`: listener `error` cho mọi BullMQ `Queue`/`Worker` qua Pino (Task 9 T14, tiếp Task 12)

Depends on: task 4, task 7, task 12

**Files**

- Create: `apps/api/src/queue/bull-error.logger.ts`
- Create: `apps/api/src/queue/bull-error.logger.spec.ts`
- Modify: `apps/api/src/queue/queue.module.ts` (thêm provider)
- Create: `apps/transcoder/src/bull-error.logger.ts`
- Create: `apps/transcoder/src/bull-error.logger.spec.ts`
- Modify: `apps/transcoder/src/app.module.ts` (thêm provider)
- Modify: `apps/transcoder/src/jobs/transcode.processor.ts`, `apps/transcoder/src/jobs/subtitle.processor.ts`, `apps/transcoder/src/jobs/cleanup.processor.ts` (thêm 1 method `@OnWorkerEvent("error")`)
- Modify: `apps/transcoder/src/jobs/transcode.processor.spec.ts`, `subtitle.processor.spec.ts`, `cleanup.processor.spec.ts` (thêm 1 case)

**Interfaces**

- Consumes: `QUEUE_TRANSCODE`, `QUEUE_SUBTITLE`, `QUEUE_CLEANUP` từ `@myflix/shared`; `InjectQueue`, `OnWorkerEvent` từ `@nestjs/bullmq`; `Queue` từ `bullmq`; `Logger` từ `@nestjs/common` (static logger → `app.useLogger(nestjs-pino)` → JSON, như Task 12); `PinoLogger` đã inject sẵn trong 3 processor.
- Produces (giống nhau ở 2 app, nội dung nguyên văn):
  ```ts
  // bull-error.logger.ts
  @Injectable()
  export class BullErrorLogger implements OnModuleInit {
    private readonly logger = new Logger("BullMQ");
    constructor(
      @InjectQueue(QUEUE_TRANSCODE) private readonly transcode: Queue,
      @InjectQueue(QUEUE_SUBTITLE) private readonly subtitle: Queue,
      @InjectQueue(QUEUE_CLEANUP) private readonly cleanup: Queue,
    ) {}
    onModuleInit(): void {
      // T14 / mission D10 — bullmq QueueBase.emit("error") console.error() stack trace thô khi Queue không có listener
      for (const queue of [this.transcode, this.subtitle, this.cleanup]) {
        queue.on("error", (err: Error) =>
          this.logger.error(`${queue.name}: ${err.message}`),
        );
      }
    }
  }
  ```
  `queue.module.ts` (api): `providers: [BullErrorLogger]` (giữ `exports: [BullModule]`); `app.module.ts` (transcoder): thêm `BullErrorLogger` vào `providers`.
- Mỗi processor (transcoder) thêm đúng 1 method, đặt ngay sau `process()`:
  ```ts
  @OnWorkerEvent("error")
  onWorkerError(err: Error): void {
    this.logger.error({ err }, "worker error"); // T14 / mission D10 — Worker không có listener "error" thì bullmq console.error() stack trace thô
  }
  ```
  (`this.logger` là `PinoLogger` đã có trong 3 class; không đổi constructor.)
- Không đổi option connection, không đổi tên queue, không thêm dependency.

**Steps**

- [x] Failing test: viết `bull-error.logger.spec.ts` ở mỗi app — dựng 3 `Queue` giả bằng `Object.assign(new EventEmitter(), { name: "transcode" })` (v.v.), `jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined)`, `new BullErrorLogger(q1, q2, q3 as never …).onModuleInit()`, rồi `q2.emit("error", new Error("ECONNREFUSED"))` → assert không throw và `Logger.prototype.error` được gọi với chuỗi chứa `"ECONNREFUSED"`; case 2: KHÔNG gọi `onModuleInit`, `q1.emit("error", new Error("x"))` → assert **throw** (chứng minh listener là thứ chặn EventEmitter ném). Thêm vào mỗi processor spec 1 case: `processor.onWorkerError(new Error("boom"))` → `logger.error` (mock PinoLogger sẵn có trong spec) được gọi với `expect.objectContaining({ err: expect.any(Error) })`. Chạy `pnpm --filter @myflix/api test -- bull-error` và `pnpm --filter @myflix/transcoder test`. Expect: FAIL — `TS2307 Cannot find module './bull-error.logger'`; processor spec `TS2339 Property 'onWorkerError' does not exist`.
- [x] Tạo 2 `bull-error.logger.ts`, thêm provider vào 2 module, thêm `onWorkerError` vào 3 processor đúng như Interfaces.
- [x] Chạy lại 2 lệnh test. Expect: PASS.
- [x] Self-review checkpoint: `BullErrorLogger` chỉ gắn listener, không gọi lệnh Redis nào (không làm chậm bootstrap); `@OnWorkerEvent` import từ `@nestjs/bullmq` (không phải `bullmq`).
- [x] Chạy `pnpm --filter @myflix/api test`, `pnpm --filter @myflix/transcoder test`, `pnpm --filter @myflix/api build`, `pnpm --filter @myflix/transcoder build`, và `cmd.lint`. Paste output vào PR.
- [x] Commit: `fix: log BullMQ queue/worker errors through Pino instead of raw console output (T14)`.

Review: ✅ r1 (S-1 wiring-metadata tests declined by plan owner — live T14 rerun is the wiring proof, recorded in PR Findings; S-2 detect_changes run via CLI after the git/Xcode workaround)

## Amendment 3 (Dev-directed, 2026-09-29) — A4 r1 S2: log request của `transcoder` thiếu `correlationId`

> A4 r1 (`docs/impl/M-platform-operations-US2-review/a4-r1.md`): NFR hàng 4 của ticket ("100% dòng log ghi trong ngữ cảnh một request mang trường `correlationId`") bị chính nhánh này vi phạm — Task 4 mở HTTP listener ở `transcoder`, `LoggerModule.forRoot({ pinoHttp: { redact } })` (Task 7) không có `genReqId`/`customAttributeKeys`, nên mỗi dòng access log `GET /health/gpu` không có `correlationId`. Dev chọn apply theo recommend: đưa `genReqId` + `PINO_HTTP_OPTIONS` (Task 6) vào `packages/shared` để cả hai app dùng chung; `api` re-export nên spec Task 6 giữ nguyên. KHÔNG chuyển tiếp id từ `probeGpu` sang `transcoder` (không AC nào yêu cầu api→transcoder; YAGNI — ghi vào Findings). A4 r1 S1 (T10 chặt hơn AC7: giá trị bị từ chối vẫn nằm ở `req.headers` của access log) → OPEN(BA), không sửa code; A4 r1 S3 (p95 < 200 ms) → đo ở Task 9 rerun, không có code.

## Task 14: NFR hàng 4 — `packages/shared`: `pino-http-options.ts` dùng chung; `transcoder` gắn `correlationId` vào access log

Depends on: task 2, task 4, task 6, task 7, task 13

**Files**

- Create: `packages/shared/src/pino-http-options.ts`
- Create: `packages/shared/src/pino-http-options.test.ts`
- Modify: `packages/shared/src/index.ts` (thêm `export * from "./pino-http-options";`)
- Modify: `apps/api/src/logger.options.ts` (thành re-export)
- Modify: `apps/transcoder/src/app.module.ts` (`LoggerModule.forRoot({ pinoHttp: PINO_HTTP_OPTIONS })`)

**Interfaces**

- Consumes: `resolveCorrelationId`, `LOG_REDACT_CONFIG` (Task 2, cùng package).
- Produces: `packages/shared/src/pino-http-options.ts` = nội dung hiện tại của `apps/api/src/logger.options.ts` chuyển nguyên văn (cả comment citation `// mission D9`, `// mission D9 nguyên văn`, `// NB1 …`, `// mission D10`), chỉ đổi import thành `import { resolveCorrelationId } from "./correlation-id"; import { LOG_REDACT_CONFIG } from "./log-redact";` (giữ `import type { IncomingMessage, ServerResponse } from "node:http";` — chỉ type, không kéo runtime). Export `genReqId`, `PINO_HTTP_OPTIONS` y hệt.
- `apps/api/src/logger.options.ts` chỉ còn: `export { genReqId, PINO_HTTP_OPTIONS } from "@myflix/shared"; // Task 14 — nguồn duy nhất, dùng chung với transcoder` — `app.module.ts` và `logger.options.spec.ts` của `api` KHÔNG đổi.
- `apps/transcoder/src/app.module.ts`: `LoggerModule.forRoot({ pinoHttp: PINO_HTTP_OPTIONS })` thay cho `{ pinoHttp: { redact: LOG_REDACT_CONFIG } }` (`PINO_HTTP_OPTIONS` đã chứa `redact: LOG_REDACT_CONFIG`); bỏ import `LOG_REDACT_CONFIG` nếu không còn dùng. Hệ quả: mỗi access log `GET /health/gpu` mang `correlationId` (client không gửi → sinh UUID v4, D9), header response `X-Correlation-Id` được echo.
- Subpath `./correlation-id` (Edge, `web`) không đổi. Không thêm dependency (`pino-http` không cần import — `PINO_HTTP_OPTIONS` là object thuần).

**Steps**

- [x] Failing test: viết `packages/shared/src/pino-http-options.test.ts` (`node:test`): (1) `genReqId({ headers: { "x-correlation-id": "t7-probe-0001" } } as never, res)` với `res = { setHeader: (k, v) => calls.push([k, v]) }` → trả `"t7-probe-0001"` và `calls` deep-equal `[["X-Correlation-Id", "t7-probe-0001"]]`; (2) header sai định dạng (`"bad id"`) → trả chuỗi khớp regex UUID v4 (copy từ `correlation-id.test.ts`) và khác `"bad id"`; (3) header mảng `["a1", "a2"]` → trả `"a1"`; (4) `PINO_HTTP_OPTIONS.customAttributeKeys` deep-equal `{ reqId: "correlationId" }`, `quietReqLogger === true`, `redact === LOG_REDACT_CONFIG`. Chạy `pnpm --filter @myflix/shared test`. Expect: FAIL — `TS2307: Cannot find module './pino-http-options'`.
- [x] Tạo `pino-http-options.ts`, thêm export vào `index.ts`, đổi `apps/api/src/logger.options.ts` thành re-export, đổi `LoggerModule.forRoot` của `transcoder` như Interfaces.
- [x] Chạy lại `pnpm --filter @myflix/shared test`. Expect: PASS (25 test, +4).
- [x] Chạy `pnpm --filter @myflix/api test` (spec `logger.options.spec.ts` của Task 6 vẫn xanh qua re-export) và `pnpm --filter @myflix/transcoder test`. Expect: PASS, không đổi số test.
- [x] Self-review checkpoint: `git diff apps/api/src/logger.options.spec.ts apps/api/src/app.module.ts` rỗng; `grep -rn "logger.options" apps/transcoder/src` rỗng (transcoder import từ `@myflix/shared`).
- [x] Chạy `pnpm --filter @myflix/shared build`, `pnpm --filter @myflix/api build`, `pnpm --filter @myflix/transcoder build`, `pnpm --filter web build` (subpath Edge không bị ảnh hưởng) và `cmd.lint`. Paste output vào PR.
- [x] Commit: `refactor(shared): share pino-http correlation options; transcoder access log carries correlationId (A4 S2)`.

Review: ✅ r2

## Amendment 4 (Dev-directed, 2026-09-29) — A5 merge-risk r1: BLOCKER (GPU capabilities) + SUGGESTED (probe không huỷ lời gọi nền)

> `docs/impl/M-platform-operations-US2-review/merge-risk.md`. BLOCKER: nhánh GPU chưa chạy live và `docker-compose.yml:147` `capabilities: [gpu, video]` có thể làm Docker đặt `NVIDIA_DRIVER_CAPABILITIES=video` (bỏ `utility` → không có `nvidia-smi` trong container) dù `environment` dòng 127 đã đặt `compute,video,utility` — thứ tự ưu tiên giữa hai nguồn không chắc; nếu xảy ra, GPU probe `down` → api 503 → nginx/web không khởi động. Dev chọn apply theo recommend: Task 15 đưa `capabilities` thành tập siêu `[gpu, compute, video, utility]` (khớp dòng 127, không bớt gì); bằng chứng GPU live vẫn là việc của Dev trên host GPU (Finding 19). SUGGESTED 3: `withTimeout` 1 s không huỷ lời gọi nền — Task 16 huỷ `HeadBucket` bằng `AbortSignal` và cho redis fail-fast khi client chưa `ready`; Postgres (`$queryRaw`, Prisma không hỗ trợ abort per-query) ghi NOTE. SUGGESTED 2 (health gộp "api sống" với "mọi thứ sau api sống", chặn nginx/web) là quyết định của ticket A1 / D8 → OPEN(SA), không sửa code.

## Task 15: NFR hồi quy — `docker-compose.yml`: GPU `capabilities` tập siêu (A5 r1 BLOCKER)

Depends on: task 5

**Files**

- Modify: `docker-compose.yml` (dòng `capabilities: [gpu, video]` của `services.transcoder.deploy.resources.reservations.devices[0]`)

**Interfaces**

- Consumes: `environment.NVIDIA_DRIVER_CAPABILITIES: compute,video,utility` (US1, `docker-compose.yml:127`) — nguồn sự thật về capability cần có.
- Produces: `capabilities: [gpu, compute, video, utility] # A5 r1 — khớp NVIDIA_DRIVER_CAPABILITIES ở environment; utility = nvidia-smi cho GPU probe (D7)`. Không đổi `driver`, `count`, không đổi env, không đổi `docker-compose.cpu.yml`.

**Steps**

- [x] Failing check: `docker compose config --format json | jq -e '.services.transcoder.deploy.resources.reservations.devices[0].capabilities == ["gpu","compute","video","utility"]'`. Expect: FAIL (exit 1) — hiện là `["gpu","video"]`.
- [x] Sửa dòng `capabilities` như Interfaces.
- [x] Chạy lại lệnh `jq -e`. Expect: exit 0. Thêm: `docker compose -f docker-compose.yml -f infra/compose/docker-compose.cpu.yml config --format json | jq -e '.services.transcoder.deploy == null or (.services.transcoder.deploy.resources.reservations.devices // []) == []'` — nhánh CPU vẫn không yêu cầu GPU (exit 0).

Exempt: config — verified by docker compose config (jq) trước/sau + bash scripts/verify-phase0.sh nhánh CPU; không có logic mới, chỉ mở rộng danh sách capability. Nhánh GPU: Dev chạy `bash scripts/verify-phase0.sh` trên host NVIDIA (DoD-0-2) và `curl /api/health` → `checks.gpu === "ok"` trước GATE 4 (Finding 19).

- [x] `cmd.lint` (prettier phủ YAML). Paste output.
- [x] Commit: `chore(compose): request compute/utility GPU capabilities so nvidia-smi is present for the probe (A5 r1)`.

Review: ✅ r1

## Task 16: AC3 — `api` health: huỷ `HeadBucket` khi quá hạn, redis fail-fast khi chưa `ready` (A5 r1 SUGGESTED 3)

Depends on: task 1, task 3, task 10

**Files**

- Modify: `packages/storage/src/storage.client.ts` (`ping`)
- Modify: `packages/storage/src/storage.client.ping.test.ts`
- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.controller.spec.ts`

**Interfaces**

- Consumes: `CHECK_TIMEOUT_MS = 1_000` (mission D8, đã có); `StorageClient.ping()` (Task 1); `withTimeout`/`probe` (Task 3).
- Produces: `StorageClient.ping(signal?: AbortSignal): Promise<void>` = `await this.s3.send(new HeadBucketCommand({ Bucket: this.buckets.source }), { abortSignal: signal }); // A5 r1 — huỷ request thua withTimeout, không giữ socket của pool 50` (tham số tuỳ chọn: caller cũ không đổi). `health.controller.ts`: `probe(() => this.storage.ping(AbortSignal.timeout(CHECK_TIMEOUT_MS)))` (`// mission D8`) và `probe(() => this.redis.status === "ready" ? this.redis.ping() : Promise.reject(new Error("redis not ready")))` (`// A5 r1 — không xếp PING vào offline queue của ioredis khi mất kết nối`). Body/status/contract không đổi; `probe` vẫn nuốt lỗi → `"fail"` (AC4).
- Spec `health.controller.spec.ts`: helper `healthyRedis()` có sẵn trả mock `{ ping }` — thêm `status: "ready"` vào helper (mở rộng fixture cho interface mới; ghi rõ trong report); case mới: redis mock `{ status: "reconnecting", ping: jest.fn() }` → `checks.redis === "fail"`, 503, `ping` KHÔNG được gọi; case mới: `storage.ping` được gọi với `expect.any(AbortSignal)` và `jest.spyOn(AbortSignal, "timeout")` nhận `1_000` (cùng kiểu Task 10).
- Spec `storage.client.ping.test.ts`: monkey-patch `send` ghi cả tham số thứ 2; case mới: `client.ping(signal)` → `sent[0][1].abortSignal === signal`; case cũ (không signal) giữ nguyên, assert `abortSignal === undefined`.

**Steps**

- [x] Failing test: thêm case storage (`abortSignal` được truyền) và 2 case api ở trên. Chạy `pnpm --filter @myflix/storage test`, `pnpm --filter @myflix/api test -- health.controller`. Expect: FAIL — storage: `TS2554 Expected 0 arguments, but got 1`; api: redis mock `reconnecting` vẫn "ok" (ping được gọi), `storage.ping` gọi không tham số.
- [x] Sửa `storage.client.ts`, build `pnpm --filter @myflix/storage build`, sửa `health.controller.ts` như Interfaces.
- [x] Chạy lại 2 lệnh test. Expect: PASS.
- [x] Self-review checkpoint: `ping()` không tham số vẫn chạy như cũ (caller nào khác? `grep -rn "\.ping(" apps packages --include=*.ts` chỉ health.controller); `probe` vẫn bọc `withTimeout` cho cả 3 check.
- [x] Chạy `pnpm --filter @myflix/storage test`, `pnpm --filter @myflix/api test`, `pnpm --filter @myflix/api build`, `cmd.lint`. Paste output vào PR.
- [x] Commit: `fix(api): abort the MinIO health probe on timeout and fail redis fast when not ready (A5 r1)`.

Review: ✅ r2

## Amendment 5 (Dev-directed, 2026-09-29) — A5 merge-risk r2 (máy GPU): SUGGESTED 3 — probe nuốt lỗi, 503 không để lại dòng log nào

> `docs/impl/M-platform-operations-US2-review/merge-risk.md` (r2, HEAD 19aa984): `Blocking: No`, SUGGESTED x3. Dev chọn: S3 sửa (Task 17); S1 (health 503 khi GPU/transcoder chết chặn nginx/web (re)start, `retries` 3) = mission D8/ticket A1 → OPEN(SA), trùng SUGGESTED 2 của r1, không sửa code; S2 (`PinoLogger.root` chỉ có khi transcoder là HTTP app) = design §5 "3 processor — `storage.run` + `PinoLogger.root.child`" (D11) và `main.ts` bắt buộc là HTTP app vì D7 → finding, không sửa. Task 17 lệch khỏi chú thích `design.md:149` ("lỗi gốc bị nuốt tại đây — AC4") ở phạm vi log phía server; AC4 chỉ ràng buộc **body**, body/status không đổi.

## Task 17: AC4/NFR quan sát — `api` + `transcoder`: log `warn` khi một phép kiểm health chuyển ok → fail (A5 r2 SUGGESTED 3)

Depends on: task 3, task 4, task 10, task 11, task 16

**Files**

- Modify: `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/health/health.controller.spec.ts`
- Modify: `apps/transcoder/src/health/gpu-probe.service.ts`
- Modify: `apps/transcoder/src/health/gpu-probe.service.spec.ts`

**Interfaces**

- Consumes: `Logger` của `@nestjs/common` (pattern đã có: `apps/api/src/queue/bull-error.logger.ts` — `new Logger("BullMQ")`, đi qua nestjs-pino nên có `correlationId` + redact D10); `probe`/`probeGpu`/`withTimeout` (Task 3/10/16); `GpuProbeService.runCheck` (Task 4/11).
- Produces (`api`): `probe(fn, onError: (err: unknown) => void)` và `probeGpu(onError)` gọi `onError(err)` trong `catch` trước khi trả `"fail"`/`"unreachable"`; `probeGpu` gọi `onError(new Error("transcoder reported gpu down"))` trước khi trả `"down"`. `HealthController`: `private readonly logger = new Logger("Health")`, `private readonly failing = new Set<string>()`; `check()` truyền `(err) => this.warnOnce("<name>", err)` cho từng phép kiểm; sau `Promise.all`, tên nào có trạng thái `"ok"`/`"not_required"` → `failing.delete(name)`. `warnOnce(name, err)`: đã có trong `failing` → bỏ qua; ngược lại `failing.add(name)` rồi `logger.warn(\`${name} check failed: ${err instanceof Error ? err.message : String(err)}\`)`. Chỉ ghi `message`— không ghi object lỗi, không ghi env/URL kết nối. Body, status code,`CheckState`/`GpuState` không đổi.
- Produces (`transcoder`): `GpuProbeService`: `private readonly logger = new Logger("GpuProbe")`; trong `catch (err)` của `runCheck`: nếu lần trước `lastOk === true` HOẶC đây là lần kiểm đầu (`lastCheckedAt === 0`) → `logger.warn(\`nvidia-smi failed: ${message}\`)`với`message`=`err.message` (execFile đã gộp exit code/stderr vào message). Thành công sau thất bại → không log (ponytail: chỉ log cạnh xuống; thêm log hồi phục khi có yêu cầu).

**Steps**

- [x] Failing test `api` (`health.controller.spec.ts`, `jest.spyOn(Logger.prototype, "warn")`): (a) redis `ping` reject `new Error("boom")` → `warn` gọi 1 lần với chuỗi chứa `"redis"` và `"boom"`, body vẫn không chứa `"boom"`; (b) gọi `check()` 2 lần liên tiếp cùng lỗi → `warn` tổng cộng 1 lần; (c) lỗi → khỏi → lỗi lại → `warn` 2 lần; (d) fetch trả `status: 503` → `warn` chứa `"gpu"`; (e) mọi thứ khỏe → `warn` 0 lần. Chạy `pnpm --filter @myflix/api test -- health.controller`. Expect: FAIL — `warn` chưa được gọi.
- [x] Failing test `transcoder` (`gpu-probe.service.spec.ts`, cùng harness `jest.mock("node:child_process")` hiện có, `jest.spyOn(Logger.prototype, "warn")`): (a) lần kiểm đầu fail → `warn` 1 lần chứa message lỗi; (b) fail 2 lần liên tiếp → `warn` 1 lần; (c) ok → fail → `warn` 1 lần. Chạy `pnpm --filter @myflix/transcoder test -- gpu-probe.service`. Expect: FAIL.
- [x] Sửa 2 file nguồn như Interfaces.
- [x] Chạy lại 2 lệnh test. Expect: PASS.
- [x] Self-review checkpoint: body `check()` không đổi hình dạng (các test cũ pass nguyên, không sửa test cũ); không log object lỗi; `probe` vẫn bọc `withTimeout`.
- [x] Chạy `pnpm --filter @myflix/api test`, `pnpm --filter @myflix/transcoder test`, `pnpm --filter @myflix/api build`, `pnpm --filter @myflix/transcoder build`, `npx eslint apps/api/src/health apps/transcoder/src/health`, `npx prettier --check` trên 4 file. Paste output.
- [x] Commit (chỉ 4 file trên + file plan này, `git add` từng đường dẫn): `fix: log a warning when a health check turns from ok to fail (A5 r2)`.

Review: ✅ r2

## Findings for the PR

1. `packages/shared/src/dto/ingest.ts` — `TranscodeJobData.correlationId` đã tồn tại sẵn (bắt buộc, `string`) từ trước ticket này — không sửa DTO này, chỉ 3 processor tiêu thụ nó thay đổi.
2. KB mismatch với code (Q9) — AC9 nghiệm thu một phần: 3/4 điểm đẩy job (`ingest.service.ts`, `admin-ops.service.ts`, `admin-subtitles.service.ts`) là `NotImplementedException` stub Phase 1; chỉ `maintenance.service.ts:61` đang chạy thật (cron, không có `correlationId`, đúng A8). T12 ("khởi động một upload") không chạy được với code hiện tại — thay bằng test enqueue trực tiếp `processor.process(fakeJob)` (Task 7). Quyết định chấp nhận bằng chứng này hay dời sang ticket ingest thuộc về BA — xem `OPEN(BA)` ở đầu file này.
3. `scripts/verify-phase0.sh` không có nội dung cần sửa cho D8 — nghĩa vụ AC27 thoả bằng cách chạy lại script (Task 5, Task 9), không phải một diff.
4. `web` middleware chạy Edge Runtime (suy luận từ việc không có `export const runtime = "nodejs"` và `logger.ts` dùng chế độ `browser` của Pino) — quyết định dùng `globalThis.crypto.randomUUID()` thay vì `node:crypto` trong `correlation-id.ts` xuất phát từ quan sát này, không phải trích dẫn trực tiếp mission D9.
5. `api.checks.gpu` sẽ luôn là `"unreachable"` khi `health.e2e-spec.ts` chạy trên host (không có route DNS tới `transcoder` ngoài mạng compose) — test chỉ kiểm hợp đồng (1 trong 4 giá trị), không kiểm giá trị cụ thể; trạng thái GPU thật chỉ quan sát được từ compose (T4/T4b, `verify-phase0.sh`).
6. D11 — cơ chế thật khác chữ "logger.child" của mission text: `nestjs-pino@4.6.1` không có `runInContext` (chỉ 5.x, đòi nâng major ngoài phạm vi ticket); dùng `storage.run(new Store(PinoLogger.root.child({ correlationId })), fn)` thay thế, kết quả tương đương.
7. D9 — theo nguyên văn (`customAttributeKeys`), cộng `quietReqLogger: true` (NB1) bắt buộc để trường `correlationId` thật sự xuất hiện trong log (xác minh thực nghiệm). Sửa lại tiền đề sai của round trước: code cũ (`customProps`) không tạo trường `reqId` trùng lặp — không có gì thật để loại bỏ, lý do đổi chỉ là bám nguyên văn D9.
8. Naming: `apps/transcoder/src/health/` đặt `gpu-probe.controller.ts`/`gpu-probe.service.ts`/`health.module.ts` — theo pattern `apps/api/src/health/` (controller + module), thêm service để tách logic polling khỏi HTTP handler.
9. Không phát hiện xung đột giữa `docs/conventions/ts.md` và style thật của repo — `ts.local.md` rỗng, không có deviation cần ghi.
10. D10 không áp cho `web`: `pino/browser.js` không hỗ trợ `redact` — thêm dòng đó không có tác dụng thật, chỉ kéo lại barrel `@myflix/shared` vào `middleware.ts`. `web` hiện không log header nào nên không có gì để redact ở `logger.ts` lúc này — giới hạn kỹ thuật, không phải thiếu sót.
11. `expose: ["4100"]` cho `transcoder` (Task 5) theo dominant style của repo, không bắt buộc kỹ thuật — container cùng mạng compose gọi nhau theo tên service bất kể có `expose` hay không.
12. R5-N1 (review round 5 NOTE) — unit test riêng cho fallback của `AllExceptionsFilter` khi `req.id` rỗng (lớp lỗi body-parser) được thêm ở Task 6 (`all-exceptions.filter.spec.ts`), tách khỏi bằng chứng e2e JSON-hỏng đã có, theo đúng ghi chú carry-to-plan của review round 5.
13. Deviation của kế hoạch so với thiết kế (không phải Finding của thiết kế, ghi ở đây để minh bạch): thiết kế §10 không cho một unit test riêng cho `GpuProbeController`/`GpuProbeService` (chỉ dựa vào T4/T4b/T4c ở tầng compose) — Task 4 vẫn thêm 1 unit test nhẹ cho `GpuProbeController.check()` (mock `ConfigService`/`GpuProbeService`) vì đây là nhánh logic 3 chiều (`not_required`/`ok`/`down`) thuần, rẻ để test, và nguyên tắc TDD của repo không có ngoại lệ cho "nhánh nhỏ". KHÔNG thêm unit test cho `GpuProbeService`'s `setInterval`/`execFileAsync` (nvidia-smi) — đây là mối quan tâm tích hợp thật (cần hardware/host thật), thiết kế đã chọn compose-level (T4/T4b/T4c) làm bằng chứng, giữ nguyên quyết định đó.

14. OPEN(BA) — T10 vs AC7 (A4 r1 S1): AC7 nguyên văn ("giá trị client gửi xuất hiện 0 lần trong log dưới dạng `correlationId`") ĐẠT — live T10 ở Task 9 rerun: 0 dòng có giá trị 65 ký tự ở trường `correlationId`, response mang UUID mới. Nhưng câu chữ T10 ("giá trị gửi lên không xuất hiện trong log") KHÔNG đạt: giá trị bị từ chối vẫn nằm 1 lần dưới `req.headers["x-correlation-id"]` của dòng access log pino-http. Che header đó nghĩa là mở rộng danh sách 3 header cố định của mission D10 — không tự quyết; BA chọn: giữ AC7 (sửa câu chữ T10) hay mở rộng D10. Biến thể T10 "chứa ký tự xuống dòng" chỉ được phủ bằng unit test (`correlation-id.test.ts`, `correlation-id.e2e-spec.ts`), không gửi live được qua curl.
15. Không chuyển tiếp `correlationId` từ `api` → `transcoder` trong `probeGpu` (A4 r1 S2, phần không áp dụng): không AC nào yêu cầu propagation api→transcoder (AC8 chỉ web→api); access log `transcoder` tự sinh UUID theo D9 (Task 14). Thêm sau nếu cần trace probe xuyên service.
16. Task 13 A3 S-1 (test metadata `@OnWorkerEvent`/`providers`) bị plan owner từ chối: bằng chứng wiring là T14 live sau Task 13 — 0 dòng non-JSON ở cả 3 service khi dừng/pause redis, 122 dòng lỗi có cấu trúc `"context":"Redis"|"BullMQ"` (`task-9-report.md`, "T14 rerun after Task 13"). `detect_changes` chạy qua CLI (`detect-changes-final.txt`, chạy lại trên mã cuối c888784: 79 file, 244 symbol, 22 process, risk `critical` do bề rộng — kể cả file scaffold .md/.kb chưa commit ngoài ticket) vì MCP bị chặn bởi Xcode license trên máy Dev. Chạy lại qua MCP tại HEAD ac9b9dc (compare `main`, máy Windows): 68 file, 251 symbol, 22 process — đều trong phạm vi ticket (correlationId ở web page, 3 processor, health `Check → WithTimeout`) — risk `critical` do bề rộng + file scaffold chưa commit.
17. Q4/Q5 (OPEN(Dev) trong ticket, BA giao Dev chốt): Q4 body health = `{ status: "ok"|"degraded", checks: { postgres, redis, minio: "ok"|"fail", gpu: "ok"|"not_required"|"down"|"unreachable" }, version }` — chốt ở design §3, hiện thực Task 3, live T1/T2/T4b; Q5 đường dẫn = `/api/health` cả trong container lẫn qua nginx, healthcheck compose hiện tại đã đúng — design §2. BA cập nhật câu chữ AC1 ("OPEN(Dev) — xem Q4") khi nghiệm thu.
18. Số đo NFR (Task 9 rerun tại Task 14 HEAD, nhánh CPU, qua nginx): hàng 1 p95 = 5,5 ms (p50 3,4 ms, max 14,1 ms, 100 lần, 100% HTTP 200) < 200 ms; hàng 2 T5 = 1,013 s ≤ 1,5 s; hàng 3 T14 537 dòng, 0 dòng non-JSON; hàng 4 phủ `correlationId` 20/20 ở `api`, 25/25 dòng access log request ở `transcoder` (dòng thứ 26 là log khởi động `RouterExplorer`, không thuộc ngữ cảnh request); hàng 5 `verify-phase0.sh` passed 4 / failed 0 (DoD-0-2 WAIVED) — chạy lại tại c888784 (mã cuối) sau A4 r3; hàng 6 T13 + S8(b) 0 rò rỉ, `[REDACTED]` hiện — chạy lại tại c888784 (login stub trả 501, mật khẩu/token/cookie thử 0 lần trong log 3 service). Lưu ý: lần đo p95 đầu vượt throttler `api` (120 req/phút) làm T2/T5 kế tiếp trả 429 — đo lại sau cửa sổ 65 s.
19. Nhánh GPU chưa chạy live: host Dev (macOS) không có NVIDIA; mọi bằng chứng compose (T1–T5, T14, verify-phase0) là nhánh CPU (`docker-compose.cpu.yml`, `gpu: "not_required"`); T4/T4b dùng `stop transcoder` → `"unreachable"`. `"ok"`/`"down"` của GPU thật chỉ được phủ bởi unit test `gpu-probe.controller.spec.ts`/`gpu-probe.service.spec.ts` — cần một lần `verify-phase0.sh` trên host có GPU trước khi đóng ticket (DoD-0-2).
    **Đã đóng (2026-09-29, host Windows + Docker Desktop, RTX 4070 SUPER, HEAD 19aa984, nhánh GPU `docker-compose.yml` gốc):** `bash scripts/verify-phase0.sh` → DoD-0-1..5 PASS (passed 5, failed 0; DoD-0-2 NVENC PASS, DoD-0-3 encode 30s `h264_nvenc` PASS); `curl http://localhost/api/health` → `200` `{"status":"ok","checks":{"postgres":"ok","redis":"ok","minio":"ok","gpu":"ok"}}`; trong `transcoder`: `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility`, `nvidia-smi -L` thấy GPU 0 (Task 15 hiệu lực). T4 live: `nvidia-smi` giả thoát mã 9 đặt trước trong PATH, chờ 35 s → `503`, `gpu:"down"`, 3 phụ thuộc kia `ok`; gỡ lỗi → `200`/`ok` sau ~9 s. T4b live: `stop transcoder` → `503`, `gpu:"unreachable"`, `time_total` 1,005 s; `start` → `200`, `gpu:"ok"`. Task 17 live (HEAD ac9b9dc): pause redis 3 lần gọi → 1 dòng `warn` `redis check failed: check timeout` (có `correlationId`); GPU lỗi → 1 dòng `gpu check failed: transcoder reported gpu down` ở `api` + 1 dòng `nvidia-smi failed: …` ở `transcoder`.
20. Image MinIO pin không còn pull được (ngoài phạm vi ticket, chặn mọi máy mới dựng stack): `docker-compose.yml:181` `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` và `minio-init` `quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z` → quay.io `no such manifest`, Docker Hub `denied`. Bằng chứng GPU ở #19 dùng retag local từ `pgsty/minio:latest` (có `minio`, `mc`, `sh`, entrypoint tương thích), không đổi repo. Đề xuất ticket riêng (owner SA/Dev): chuyển sang mirror được duy trì (`pgsty/minio` hoặc `cgr.dev/chainguard/minio` + image `mc` có `sh`) và kiểm lại healthcheck `mc ready local`.
21. OPEN(SA) — A5 r2/r3 S1 (trùng r1 SUGGESTED 2): health 503 khi GPU/`transcoder` lỗi + `nginx`/`web` `depends_on: api: service_healthy` + `retries: 3` (~30 s) → `compose up -d` trong lúc GPU lỗi làm mất cả site (kể cả playback). Là hệ quả của mission D8 / ticket A1; SA quyết: giữ, hay tách healthcheck compose sang phép kiểm lõi (postgres/redis/minio) và giữ body 4 phụ thuộc cho vận hành.
22. A5 r2/r3 S2 (Dev: finding, không sửa): 3 processor dùng `PinoLogger.root` (design §5, D11) — chỉ được gán khi `transcoder` là HTTP app (`NestFactory.create`, bắt buộc bởi D7). Nếu `main.ts` quay về `createApplicationContext`, job ném TypeError trước `try` và kẹt `QUEUED`. Follow-up: một boot smoke test `NestFactory.create(AppModule)` → `GET /health/gpu`.
23. A5 r3 S3-gap (Dev: follow-up, không sửa trong ticket này): dòng `warn` của Task 17 chỉ ghi `err.message` — MinIO 403 không body → `UnknownError`; DNS lỗi và từ chối kết nối đều là `fetch failed` (mã thật ở `err.cause.code`); `health.controller.ts:95` non-503 với body sai → `unreachable` mà không gọi `onError`; không có dòng hồi phục. Đề xuất: thêm `err.name`, `cause?.code`, `$metadata?.httpStatusCode` vào dòng log, gọi `onError` trước dòng 95, mỗi case 1 test.
24. A5 r2/r3 NOTE/NITS (ghi nhận, không sửa): `cleanup.processor.ts:27` `resolveCorrelationId(undefined)` bỏ qua `job.data.correlationId` (khác 2 processor kia — job cleanup từ request sẽ mất id, lệch AC9 "100%"); body health bỏ `queue.{waiting,active}` và 503 nay phủ cả minio/gpu → ghi vào release notes cho monitor ngoài; probe postgres/redis thua `withTimeout` không bị huỷ (`SELECT 1`/PING dồn khi Postgres treo) → single-flight hoặc `statement_timeout`; `app.module.ts:28` (có sẵn) thiếu `trust proxy` — mọi client qua nginx chung 1 bucket throttler 120/phút; health chỉ thấy 1 replica `transcoder` (giả định single-replica); nhánh CPU mỗi lần khởi động log `spawn nvidia-smi ENOENT` (báo động giả) và `killed`/`signal` của timeout 5 s không được ghi; `packages/shared/package.json:22` glob nháy đơn không chạy dưới `cmd` Windows.
25. Môi trường (host Windows, không phải lỗi code): `cmd.test` cần `pnpm -r build` trước để `prisma generate` (đúng thứ tự CI `ci.yml:35-36`); `next build` của `web` fail `EPERM symlink` ở bước `output: standalone` khi Windows chưa bật Developer Mode — type-check/compile đã qua, image `web` build trong Docker (Linux) `healthy`.

## Review record

| Date       | Round | Verdict                        | Reviewer      | Open gaps                                                                                                                                   |
| ---------- | ----- | ------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-29 | 1     | BLOCKER x2, SUGGESTED x11      | plan-reviewer | B1, B2, S1–S11 applied by fix subagent; NOTE x6, NITS x6 recorded                                                                           |
| 2026-09-29 | 2     | BLOCKER x1, SUGGESTED x3       | plan-reviewer | R2-B1, S8(a), R2-S1, R2-S2 applied by fix subagent; NOTE x2, NITS x3 recorded                                                               |
| 2026-09-29 | 3     | clean (0 BLOCKER, 0 SUGGESTED) | plan-reviewer | NOTE x1 (R3-N1 `as never` casts in Task 7 specs), NITS x1 recorded; carry NT3 (mission D9/D10 citation comments) into Task 2 implementation |
