# Technical design — M-platform-operations-US2 (F-045: Health check & log tập trung)

path: architectural
status: approved

## 1. Tóm tắt phạm vi

Ticket phủ 2 việc độc lập nhưng cùng chạm `api`, `web`, `transcoder`:
(a) endpoint health hiện có (`apps/api/src/health/health.controller.ts`) kiểm
thêm GPU qua một HTTP probe mới trong `transcoder`, bọc timeout, và bỏ số job
đang chờ; (b) `correlationId` được sinh/nhận đúng quy tắc, echo vào response
header, xuyên qua `web` → `api` → hàng đợi → `transcoder`, và 3 header nhạy
cảm luôn bị che trong log của cả 3 service. Không có bảng nào được tạo hay sửa
(Data changes: none).

Tất cả cơ chế đều DECIDED ở mission D7–D11; thiết kế này hiện thực đúng các
quyết định đó, cộng 2 việc OPEN(Dev) ticket giao: Q4 (hình dạng body) và Q9
(liệt kê điểm đẩy job) — Q4 được chốt ở §3, Q9 được chốt ở §5 dưới đây
(R4-T1), không còn mở.

## 2. Placeholder / grounding đã giải quyết (từ context cache)

| Mục | Giá trị | Bằng chứng |
|---|---|---|
| Q5 — đường dẫn endpoint health | `/api/health` cả trong container lẫn qua nginx; healthcheck compose hiện tại **đã đúng**, không cần sửa lệnh | `apps/api/src/main.ts:14` (`setGlobalPrefix("api")`) + `health.controller.ts:14` (`@Controller("health")`); `infra/nginx/templates/myflix.conf.template:29-31` (`location /api/` → `proxy_pass http://api:4000;` không cắt tiền tố); `docker-compose.yml:105` |
| healthcheck `api` hiện tại | `interval: 10s, timeout: 5s, retries: 10, start_period: 40s` — D8 chỉ đổi `timeout`/`retries` | `docker-compose.yml:99-104` (đọc trực tiếp trong lượt thiết kế này) |
| `nvidia-smi` khả dụng trong `transcoder` | `NVIDIA_DRIVER_CAPABILITIES: compute,video,utility` — `utility` là capability cần cho `nvidia-smi` | `docker-compose.yml` service `transcoder`; comment `infra/ffmpeg/Dockerfile:50` |
| `TRANSCODE_ENCODER` 2 nhánh | Gốc `${TRANSCODE_ENCODER:-h264_nvenc}`; CPU override `libx264` — khớp quy tắc "không kết thúc `_nvenc`" | `docker-compose.yml:120`; `infra/compose/docker-compose.cpu.yml:8` |
| Q9 — điểm đẩy job | Xem §4 — 3 trong 4 điểm là `NotImplementedException` stub (Phase 1, ngoài phạm vi); chỉ có 1 điểm đang chạy thật | `ingest.service.ts:35`, `admin-ops.service.ts:41`, `admin-subtitles.service.ts:14`, `maintenance.service.ts:61` |
| MinIO probe | `StorageService extends StorageClient` (`@myflix/storage`) — chưa có method "ping" nhẹ, thiết kế thêm ở §3.2 | `apps/api/src/storage/storage.service.ts`; `packages/storage/src/storage.client.ts` |
| `transcoder` chưa có HTTP listener | `NestFactory.createApplicationContext`, không `@nestjs/platform-express` trong `apps/transcoder/package.json` | `apps/transcoder/src/main.ts:14`; `apps/transcoder/package.json` (so với `apps/api/package.json:24`) |

## 3. Endpoint health — body shape (Q4, OPEN(Dev) → chốt ở đây)

Giữ khung cũ `status/checks/version`, bỏ `queue` (Q2/D7), thêm `minio` và
`gpu`:

```ts
type CheckState = "ok" | "fail";
type GpuState = "ok" | "not_required" | "down" | "unreachable"; // D7 + Q4/Q11

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

`healthy = postgres==="ok" && redis==="ok" && minio==="ok" && (gpu==="ok" ||
gpu==="not_required")` — `status: healthy?"ok":"degraded"`, HTTP `200`/`503`
tương ứng (`res.status(503)` khi không healthy, giữ nguyên pattern hiện có).

`GET /health` (`api` nội bộ) — `Public()` đã có sẵn trên controller và
`HealthController` **chưa từng** bị `JwtAuthGuard` gắn (`@UseGuards` chỉ đặt
theo từng controller trong repo này, không có `APP_GUARD` toàn cục cho auth —
chỉ `ThrottlerGuard` là global). AC1's "không kèm Authorization" đã thỏa sẵn,
không cần sửa gì cho phần auth.

### `apps/api/src/health/health.controller.ts` — viết lại

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
    timer = setTimeout(() => reject(new Error("check timeout")), CHECK_TIMEOUT_MS);
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

`BullMQ`/`InjectQueue` bị gỡ khỏi constructor (Q2/D7 loại số job đang chờ) —
đây là thay đổi chữ ký, không còn `Queue` injected. `withTimeout`/`probe` bọc
đều 4 phép kiểm trong `CHECK_TIMEOUT_MS`, chạy song song bằng `Promise.all` —
tổng thời gian ≈ max(4 phép kiểm) ≤ 1.000 ms + overhead nhỏ, luôn dưới 1.500 ms
của AC3.

**AC4 (0 rò rỉ nội bộ) đúng theo cấu trúc**: `probe()`/`probeGpu()` không bao
giờ đưa `error.message`/exception gốc vào body — chỉ 5 literal string cố định
xuất hiện trong `checks`. Không cần allowlist trường body.

### `packages/storage/src/storage.client.ts` — thêm `ping()`

```ts
import { HeadBucketCommand, /* ...các import hiện có... */ } from "@aws-sdk/client-s3";
// trong class StorageClient
async ping(): Promise<void> {
  await this.s3.send(new HeadBucketCommand({ Bucket: this.buckets.source }));
}
```

Không có method rẻ tiền nào sẵn có cho "còn sống"; `HeadBucketCommand` là
lệnh S3 nhẹ nhất, dùng lại `s3`/`buckets` field đã có — không thêm dependency.
`StorageService` (api) kế thừa method này miễn phí.

`apps/api/src/config/env.ts` — **không sửa file này** (B3): D7 nói rõ "không
thêm env key mới cho `api`". URL GPU probe là hằng số cố định
`TRANSCODER_GPU_URL` khai thẳng trong `health.controller.ts` (xem §3), không
qua `ConfigService`/Zod schema — diff nhỏ hơn, khớp D7 từng chữ, và không lệ
thuộc hành vi fallback `process.env` của `ConfigService.get()`.

## 4. Correlation ID — `packages/shared/src/correlation-id.ts` [NEW: D9]

```ts
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/; // mission D9

export function isValidCorrelationId(v: unknown): v is string {
  return typeof v === "string" && CORRELATION_ID_PATTERN.test(v);
}

export function generateCorrelationId(): string {
  // Web Crypto global — chạy được cả trên Node (api, transcoder) lẫn Next.js
  // Edge Runtime (web middleware chạy Edge theo mặc định, xem §5); KHÔNG
  // import "node:crypto" vì API đó không có trên Edge Runtime.
  return globalThis.crypto.randomUUID(); // mission D9
}

export function resolveCorrelationId(candidate?: string | null): string {
  return isValidCorrelationId(candidate) ? candidate : generateCorrelationId();
}
```

Cả `api`, `web`, `transcoder` đều đã có `@myflix/shared` trong dependencies
(grounding notes) — không cần thêm package. Thêm `export * from
"./correlation-id";` và `export * from "./log-redact";` vào
`packages/shared/src/index.ts` — dùng được ngay cho `api`/`transcoder` (Node,
không có ràng buộc Edge).

`packages/shared/package.json` — 2 thay đổi:

```json
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./correlation-id": {
      "types": "./dist/correlation-id.d.ts",
      "default": "./dist/correlation-id.js"
    }
  },
  "scripts": {
    "test": "tsc -p tsconfig.json && node --test 'dist/**/*.test.js'"
  }
}
```

1. Subpath export `"./correlation-id"` (B2, xem §6) — `correlation-id.ts`
   không có dependency nào, nên `web` import thẳng
   `@myflix/shared/correlation-id` thay vì barrel `@myflix/shared`
   (`index.ts` re-export `./password`, và `password.ts` import
   `@node-rs/argon2` — native addon không chạy được trên Edge Runtime của
   Next.js Middleware).
2. Script `test` đổi glob `dist/media/*.test.js` → `'dist/**/*.test.js'`
   (S4, **có dấu nháy đơn** — bắt buộc) — glob cũ chỉ khớp thư mục `media/`;
   `correlation-id.test.ts` [NEW, xem AC6/AC7 ở §10] đặt tại
   `packages/shared/src/correlation-id.test.ts` (dùng `node:test` như
   `media/*.test.ts`), nằm ngoài `media/`, nên nếu không đổi glob thì CI
   không bao giờ chạy test này. **Dấu nháy là bắt buộc, không phải style**:
   pnpm chạy script `test` qua `sh`, và `sh` không hỗ trợ globstar `**` —
   nếu để trần (`dist/**/*.test.js`), shell tự giãn glob trước khi Node thấy
   nó, và chỉ khớp `dist/<1 thư mục>/*.test.js` (bỏ sót file gốc
   `dist/correlation-id.test.js`). Xác minh thực nghiệm (script scratchpad,
   2 file `dist/correlation-id.test.js` + `dist/media/m.test.js`, chạy qua
   `sh -c`): bản không nháy chỉ báo `# tests 1` (chạy mỗi `media`); bản có
   nháy đơn báo `# tests 2` (Node 22 tự glob `**` đúng cả hai file).

### `packages/shared/src/log-redact.ts` [NEW: D10]

```ts
export const LOG_REDACT_CONFIG = {
  paths: [
    "req.headers.authorization",
    "req.headers.cookie",
    'res.headers["set-cookie"]',
  ],
  censor: "[REDACTED]",
}; // mission D10 — pino-http/pino mặc định không log body, nên không cần
   // danh sách trường body (US2 Q13 đóng theo D10)
```

### `apps/api/src/logger.options.ts` [NEW: R4-S1] — `genReqId` và `PINO_HTTP_OPTIONS`

`genReqId` tách thành hàm export riêng (thay vì arrow function ẩn danh) để
unit test gọi trực tiếp được (S2 — RED thật nằm ở việc echo header, không
phải ở việc nhận `x-correlation-id`/gắn `correlationId`, vốn code cũ đã làm
đúng). **R4-S1 — đặt ở file riêng, không phải `app.module.ts`**: `app.module.ts:26`
gọi `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` ngay
lúc module được nạp, và `validateEnv` (`config/env.ts`) ném lỗi đồng bộ khi
thiếu biến môi trường bắt buộc (`DATABASE_URL`, `S3_*`, `JWT_*`,
`MEDIA_SIGNING_SECRET`) — import `app.module.ts` trong unit test (chỉ để lấy
`genReqId`/`PINO_HTTP_OPTIONS`) chạy luôn `validateEnv` đó và làm sập cả tiến
trình Jest khi thiếu env, kể cả CI (`.github/workflows/ci.yml` chạy
`pnpm -r test` không set env nào, và jest config của `api` không có
`setupFiles`). `apps/api/src/logger.options.ts` chỉ import `node:http`
(type) và `@myflix/shared` — không đụng `config/env.ts`/`ConfigModule`, nên
import được an toàn từ test:

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveCorrelationId, LOG_REDACT_CONFIG } from "@myflix/shared";

export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const raw = req.headers["x-correlation-id"];
  const id = resolveCorrelationId(Array.isArray(raw) ? raw[0] : raw);
  res.setHeader("X-Correlation-Id", id); // AC5/AC6 — có ở mọi mã HTTP kể cả 500
  return id;
}

// R3-S2 — export riêng thay vì object ẩn danh: test AC5/AC10 (§10) import
// đúng object này, nên xoá `quietReqLogger`/1 path `redact` khỏi đây (lặp
// lại hồi quy NB1/thiếu redact) sẽ làm đúng test đó đỏ, không phải đỏ giả
// bằng literal test tự dựng lại cấu hình.
export const PINO_HTTP_OPTIONS = {
  genReqId,
  customAttributeKeys: { reqId: "correlationId" }, // mission D9 nguyên văn
  quietReqLogger: true, // NB1 — bắt buộc, xem xác minh thực nghiệm dưới đây
  redact: LOG_REDACT_CONFIG, // mission D10
};
```

### `apps/api/src/app.module.ts` — `pinoHttp` options

`app.module.ts` import lại `PINO_HTTP_OPTIONS` từ file trên để dùng trong
`LoggerModule.forRoot` (R4-S1 — coupling mà R3-S2 cần vẫn giữ nguyên, chỉ đổi
vị trí export; test AC5/AC10 ở §10 import cùng object từ
`./logger.options`, không phải từ `app.module.ts`):

```ts
import { PINO_HTTP_OPTIONS } from "./logger.options";
// ...
LoggerModule.forRoot({
  pinoHttp: PINO_HTTP_OPTIONS,
}),
```

`genReqId(req, res)` là chữ ký thật của `pino-http` (nhận cả `res`) — xác
minh qua Context7 `/pinojs/pino-http` §"GenReqId Interface" và ví dụ
`res.setHeader('X-Request-Id', id)` ngay trong hook đó, đúng cách D9 mô tả.
Set header ở đây chạy **trước** route handler và trước
`AllExceptionsFilter`, và `res.setHeader` không bị `res.status().json()` xoá
— nên header còn nguyên ở mọi status code khi request đi qua middleware
`pino-http` bình thường, kể cả 500 qua `AllExceptionsFilter` (đã đọc `req.id`
cho `ApiErrorBody.correlationId` sẵn). **R3-S4 — ngoại lệ lớp lỗi
body-parser** (xem cuối §4, sau đoạn `AllExceptionsFilter` bên dưới): khi
Express body-parser gọi `next(err)` trước khi middleware `pino-http` kịp
chạy, `genReqId` không chạy nên `req.id` rỗng và header chưa được set —
`AllExceptionsFilter` **có đổi** để bù trường hợp này, không còn giữ nguyên
như bản round 2.

**NB1 — `customAttributeKeys` một mình không đủ, cần thêm `quietReqLogger:
true`.** Xác minh thực nghiệm trên `pino-http@10.5.0` cài ở `apps/api`
(script Node độc lập dựng `pinoHttp(opts, memStream)` + 1 request HTTP thật,
đọc lại các dòng log JSON):

| Cấu hình | Dòng `request completed` |
|---|---|
| `customAttributeKeys: { reqId: "correlationId" }` một mình | **không có** trường `correlationId` nào (chỉ có `req` object lồng `id`) |
| `+ quietReqLogger: true` | có `correlationId: "t7"` |
| `customProps: (req) => ({ correlationId: req.id })` (code cũ) | có `correlationId: "t7"`, **không** có trường `reqId` nào ở cấp trên cùng |

Lý do (đọc `pino-http/logger.js@10.5.0`): `customAttributeKeys.reqId` chỉ đổi
tên biến nội bộ `requestIdKey`, và biến đó **chỉ được dùng** ở dòng
`quietReqLogger ? logger.child({ [requestIdKey]: req.id }) : logger`
(`logger.js:143`) — không bật `quietReqLogger` thì khoá đó không bao giờ
được ghi vào output. Vậy `customAttributeKeys` một mình (như thiết kế round
1 sửa) không đạt AC5/AC6 ("100% dòng log `api` mang `correlationId`"), dù
đúng nguyên văn chữ D9. Chọn phương án nhỏ nhất còn đúng: giữ
`customAttributeKeys: { reqId: "correlationId" }` (giữ đúng chữ D9) và thêm
`quietReqLogger: true` (kiểu có sẵn trong `pino-http/index.d.ts:41`) để khoá
đó thực sự được áp dụng. Đây vẫn là diễn giải D9 (D9 không nhắc
`quietReqLogger`), nên ghi vào `## Findings` là một độ lệch có lý do thực
nghiệm, không phải trích nguyên văn.

Tác dụng phụ của `quietReqLogger: true`: các dòng log phát ra **trong lúc**
xử lý request (qua `req.log`/`this.logger` trong handler) không còn kèm
object `req` đầy đủ nữa — chỉ còn `correlationId`; dòng `request completed`
cuối cùng (qua `res.log`, không bị `quietReqLogger` ảnh hưởng, chỉ
`quietResLogger` mới ảnh hưởng dòng này, và design không bật nó) **vẫn giữ**
cả `req` object lẫn `correlationId`, giữ đúng hình dạng log hiện có cho dòng
đó — không cần đổi gì trong `AllExceptionsFilter` hay chỗ đọc log khác.

`customAttributeKeys: { reqId: 'correlationId' }` (kiểu `CustomAttributeKeys`
có sẵn trong `pino-http@10.5.0/index.d.ts`) đổi tên khóa `reqId` trong mọi
dòng log HTTP thành `correlationId` khi `quietReqLogger: true` — đúng D9
nguyên văn (cộng NB1 ở trên), thay `customProps` của code cũ. **Sửa Finding
7 (S6 cũ): tiền đề "code cũ tạo thêm trường `reqId` trùng lặp cạnh
`correlationId`" là sai** — xác minh thực nghiệm ở bảng trên cho thấy code
cũ (`customProps`) không bao giờ ghi `reqId` ở cấp trên cùng; xem Finding 7
đã sửa lại bên dưới. `req.id` (giá trị trả về từ `genReqId`) không đổi tên
bởi `customAttributeKeys` — vẫn dùng được nguyên trạng cho
`ApiErrorBody.correlationId` trong `AllExceptionsFilter`.

`AllExceptionsFilter`: `redact` cũ chỉ có 2/3 path (thiếu
`res.headers["set-cookie"]`) — thay bằng `LOG_REDACT_CONFIG` (áp dụng ở
`app.module.ts` qua `PINO_HTTP_OPTIONS`, định nghĩa ở `logger.options.ts` —
R4-S1, không phải trong filter).

**R3-S4 — header dự phòng cho lớp lỗi body-parser.** Ticket AC6 đòi response
trả header `X-Correlation-Id` "với **mọi** mã HTTP, 2xx, 4xx lẫn 5xx"
(nguyên văn). Bằng chứng (đọc `@nestjs/core@11.2.5/nest-application.js:100-106`,
hàm `init()`): `useBodyParser && this.registerParserMiddleware();` chạy
**trước** `await this.registerModules();` và `await this.registerRouter();`
— hai lệnh sau mới đăng ký middleware của `LoggerModule` (`pino-http`, nơi
`genReqId` set header). Khi body-parser gặp JSON hỏng hoặc payload quá giới
hạn, Express gọi `next(err)` và bỏ qua mọi middleware 3 tham số đăng ký sau
nó — trong đó có `pino-http` — nên `genReqId` không chạy, `req.id` rỗng.
`AllExceptionsFilter` vẫn chạy (là error-handling middleware của Nest) và
trả 400, nhưng với `correlationId: String(req.id ?? "")` = `""` và không có
header `X-Correlation-Id` — vi phạm câu "mọi mã HTTP" ở trên. Sửa nhỏ nhất
còn đúng, đầu `catch()`:

```ts
catch(exception: unknown, host: ArgumentsHost): void {
  const ctx = host.switchToHttp();
  const req = ctx.getRequest<Request & { id?: string }>();
  const res = ctx.getResponse<Response>();

  // R3-S4/R4-S3 — body-parser lỗi (next(err)) bỏ qua middleware pino-http,
  // nên genReqId chưa chạy tới đây: gọi lại nó trước khi trả response.
  if (!req.id) req.id = genReqId(req, res);

  // ...phần còn lại giữ nguyên (status/body/log)...
  res.status(status).json(body);
}
```

thêm `import { genReqId } from "../../logger.options";` vào import có sẵn
(file đã import `ApiErrorBody, ERROR_HTTP_STATUS, ErrorCode` từ
`@myflix/shared`) — R4-S1/R4-S3, không import từ `app.module.ts` (tránh vòng
import `app.module` ↔ filter). **R4-S3 — vì sao không còn nhánh
`getHeader()` riêng**: `genReqId(req, res)` (§4, kiểu `(req: IncomingMessage,
res: ServerResponse) => string`, đúng chữ ký `GenReqId` của
`pino-http/index.d.ts:45-47`) vừa `resolveCorrelationId(...)` (tự sinh UUID
v4 khi header thiếu/sai định dạng, D9) vừa `res.setHeader("X-Correlation-Id",
id)` không điều kiện — nên nếu `req.id` đã có (middleware `pino-http` đã
chạy) thì header cũng đã được set từ trước, và nếu `req.id` rỗng thì gọi lại
`genReqId` vừa gán `req.id` vừa tự set header, không cần đọc lại
`res.getHeader(...)`. Snippet cũ gọi thẳng
`resolveCorrelationId(req.headers["x-correlation-id"])` đỏ TS2345:
`req.headers["x-correlation-id"]` có kiểu `string | string[] | undefined`
(`@types/node/http.d.ts:50`, `IncomingHttpHeaders extends
NodeJS.Dict<string | string[]>`) mà `resolveCorrelationId(candidate?: string
| null)` không nhận `string[]`; `genReqId` xử lý đúng chỗ này bằng
`Array.isArray(raw) ? raw[0] : raw` (§4), nên gọi qua nó tránh luôn lỗi kiểu
đó. Thêm 1 case e2e (R3-S4): gửi request `Content-Type: application/json`
với body JSON hỏng (ví dụ cắt cụt `{"`) tới 1 route có body trong
`apps/api/test/health.e2e-spec.ts` hoặc 1 file e2e cạnh nó (Dev chọn) —
assert `400` và có header `X-Correlation-Id` khớp UUID v4. Xem thêm AC6 ở
§10.

**R4-S2 — harness e2e phải đăng ký `AllExceptionsFilter`.**
`AllExceptionsFilter` không được đăng ký bằng `APP_FILTER`; `app.module.ts`
chỉ khai nó ở `providers: [AllExceptionsFilter]` — việc đăng ký diễn ra
trong `main.ts:22` qua `app.useGlobalFilters(app.get(AllExceptionsFilter))`,
gọi trước `app.enableShutdownHooks()`/`app.listen()`. `beforeAll` của case
e2e JSON hỏng ở trên (và của `health.e2e-spec.ts` nói chung, xem AC1 ở §10)
phải gọi đúng dòng đó — `app.useGlobalFilters(app.get(AllExceptionsFilter))`
— trước `app.init()`, giống `main.ts`. Thiếu bước này, lỗi body-parser đi
qua `BaseExceptionFilter` mặc định của Nest thay vì `AllExceptionsFilter`,
nên response 400 không có header `X-Correlation-Id` dù fallback ở trên đã
đúng — test không phân biệt được "chưa sửa" với "đã sửa". `AllExceptionsFilter`
đã có sẵn trong `AppModule.providers`, nên `app.get(AllExceptionsFilter)`
resolve được thẳng từ `TestingModule` đã compile, không cần thêm provider
nào cho test.

### `apps/transcoder/src/app.module.ts`

```ts
LoggerModule.forRoot({ pinoHttp: { redact: LOG_REDACT_CONFIG } }), // mission D10
```

Không thêm `genReqId`/`customProps` — probe GPU nội bộ không phải khái niệm
"request của người dùng" theo AC5-8; correlationId của `transcoder` chỉ tồn
tại ở tầng job (dưới đây).

### 3 processor — `storage.run` + `PinoLogger.root.child` (mission D11, giữ `nestjs-pino@4.6.1`)

**B1 — sửa xác minh phiên bản sai của Context7.** Lockfile chỉ có
`nestjs-pino@4.6.1` (`apps/api`, `apps/transcoder` khai `^4.2.0`, không có
`exports` map trong `package.json` — chỉ `main`/`types`, nên deep-import vẫn
hợp lệ ở cả runtime lẫn kiểu). `PinoLogger.d.ts` của bản 4.6.1 chỉ có
`trace…fatal`, `setContext`, `assign` — **không có `runInContext`**;
`runInContext` chỉ xuất hiện ở `nestjs-pino@5.x`, đòi peer `pino ^10`/
`pino-http ^11`, trong khi repo đang dùng `pino@9.14.0`/`pino-http@10.5.0`.
Context7 trả tài liệu bản mới nhất (5.x), không phải bản đang pin — nâng 3
thư viện ở 2 app không thuộc phạm vi ticket này (không AC nào yêu cầu), nên
giữ nguyên 4.6.1 và đổi cơ chế.

`PinoLogger.assign()` cũng không dùng được ở đây: nó đọc
`storage.getStore()` và `throw` khi rỗng (`"unable to assign extra fields
out of request scope"`), đúng như Context7 cảnh báo — một BullMQ processor
không chạy trong request scope nên store luôn rỗng lúc bắt đầu job.

**Cơ chế thay thế, dùng đúng API có ở 4.6.1:** bọc thân `process()` bằng
`storage.run(new Store(PinoLogger.root.child({ correlationId })), fn)`,
import `storage`/`Store` từ `nestjs-pino/storage` (deep import, hợp lệ vì
không có `exports` map). `PinoLogger.root` được `LoggerModule.forRoot()` gán
trong `configure()` — chạy lúc Nest dựng module ở bootstrap (`pinoHttp(...)`
tạo middleware ngay lúc đó), **không phải** lúc có request HTTP đầu tiên —
nên `root` luôn sẵn sàng trước khi job đầu tiên chạy, kể cả nếu chưa ai gọi
`/health/gpu`. `PinoLogger`'s instance getter `logger` đọc
`storage.getStore()?.logger || outOfContext` — mọi lệnh gọi trên
`PinoLogger` injected (`.info()`, `.warn()`, …) đi qua getter này. Nest's
built-in `Logger` (từ `@nestjs/common`, dùng bởi `new Logger(...)` trong
`FfmpegService`/`KeyframeVerifier`) sau `app.useLogger(app.get(Logger))`
(nestjs-pino's `Logger`, xem §7 `main.ts`) cũng wrap một `PinoLogger` inject
và route qua cùng getter — nên **mọi** dòng log phát ra trong lúc
`storage.run(...)` đang active, kể cả từ các service khác được processor
gọi, đều mang `correlationId`, đúng yêu cầu "100%" của AC9/D11. Độ lệch so
với chữ "`logger.child({ correlationId })`" của D11 (cơ chế thật là
`storage.run` + `PinoLogger.root.child`, không gọi `.child()` trực tiếp
trên từng dòng log) được ghi vào `## Findings`.

`apps/transcoder/src/jobs/transcode.processor.ts` — inject `PinoLogger` thay
`new Logger(...)`, bọc thân `process()`:

```ts
import { storage, Store } from "nestjs-pino/storage";
import { PinoLogger } from "nestjs-pino";
import { resolveCorrelationId } from "@myflix/shared";
// ...

constructor(
  private readonly prisma: PrismaService,
  private readonly storage: StorageService,
  private readonly ffmpeg: FfmpegService,
  private readonly keyframes: KeyframeVerifier,
  private readonly events: JobEventsPublisher,
  private readonly config: ConfigService,
  private readonly logger: PinoLogger, // thay `new Logger(TranscodeProcessor.name)`
) { super(); }

async process(job: Job<TranscodeJobData>): Promise<void> {
  const { assetId, jobId } = job.data;
  const correlationId = resolveCorrelationId(job.data.correlationId);
  return storage.run(
    new Store(PinoLogger.root.child({ correlationId })),
    async () => {
      const startedAt = Date.now();
      this.logger.info({ jobId, assetId }, "job started"); // .info thay .log — PinoLogger, không phải Nest Logger
      try { /* thân try/catch/finally giữ nguyên, bỏ correlationId khỏi từng lệnh log (đã có trong context) */ }
      // ...
    },
  );
}
```

`apps/transcoder/src/jobs/subtitle.processor.ts` — thêm field vào
`SubtitleJobData` (interface local, không đưa vào `packages/shared` vì chỉ 1
consumer nội bộ):

```ts
export interface SubtitleJobData {
  assetId: string;
  subtitleTrackId: string;
  sourceKey: string;
  lang: string;
  correlationId?: string; // mission D11 — optional: job dọn dẹp/cron không có
}
```

Cùng pattern `storage.run(new Store(PinoLogger.root.child({ correlationId })), fn)`
với `resolveCorrelationId(job.data.correlationId)`, inject `PinoLogger` thay
`new Logger(SubtitleProcessor.name)`.

`apps/transcoder/src/jobs/cleanup.processor.ts` — `job.data` hiện là `{}`
(job "drain" trong `maintenance.service.ts:61` không truyền field nào) →
`resolveCorrelationId(undefined)` luôn sinh **1 UUID v4 mới mỗi lần
`process()` chạy** — đúng A8/T12b ("mỗi lần chạy job đều lọc được theo MỘT
correlationId", không phải một giá trị cố định toàn cục). Bọc toàn bộ thân
hàm hiện có (vòng `for` xoá `deletionQueue`) trong cùng `storage.run(...)`,
inject `PinoLogger` thay `new Logger(CleanupProcessor.name)`.

## 5. Q9 — điểm đẩy job trong `api` (OPEN(Dev) → chốt ở đây)

| # | File:line | Queue | Kích hoạt | Trạng thái code hiện tại | `correlationId` |
|---|---|---|---|---|---|
| 1 | `ingest.service.ts:35` `IngestService.complete` | `QUEUE_TRANSCODE` | request (upload hoàn tất) | `NotImplementedException` — **chưa có lệnh `.add()` thật** | Chữ ký method đã có `_correlationId: string` (comment sẵn: "pass the request's correlationId... NFR-46") — khi Phase 1 hiện thực, phải truyền vào `TranscodeJobData.correlationId` |
| 2 | `admin-ops.service.ts:41` `AdminOpsService.retryJob` | `QUEUE_TRANSCODE` | request (admin retry) | `NotImplementedException` — chưa có `.add()` | Khi hiện thực, lấy từ `req.id` của request retry |
| 3 | `admin-subtitles.service.ts:14` `AdminSubtitlesService.upload` | `QUEUE_SUBTITLE` | request (upload phụ đề) | `NotImplementedException` — chưa có `.add()` | Khi hiện thực, gán vào `SubtitleJobData.correlationId` mới thêm ở §4 |
| 4 | `maintenance.service.ts:61` `MaintenanceService.onModuleInit` | `QUEUE_CLEANUP` | cron (`repeat`, `jobId: "deletion-queue-drain"`) | **Đang chạy thật** — `.add()` có sẵn | Không có (cron, không có request) — đúng A8/D11: `CleanupProcessor` tự sinh UUID v4 |

**Kết luận**: 3/4 điểm là stub Phase 1 (ngoài phạm vi US2 — implement chúng
là việc của ticket ingest/admin khác). US2 **không thêm code enqueue** ở
`api` vì không có lệnh `.add()` thật nào để sửa ngoài điểm #4 (vốn không cần
đổi — nó vẫn đúng A8 y như cũ). Hợp đồng cho 3 điểm còn lại được ghi lại
bằng: (a) `TranscodeJobData.correlationId: string` đã tồn tại và bắt buộc
trong `packages/shared/src/dto/ingest.ts`, không đổi; (b) `SubtitleJobData`
được thêm field optional ở §4 để khi Phase 1 hiện thực, type đã sẵn hợp đồng.
Bản thân 3 processor được sửa ngay bây giờ (đọc job.data + fallback UUID v4)
— đây là phần thật của US2, độc lập với việc `api` có gọi `.add()` thật hay
chưa.

**AC9 không nghiệm thu được đầy đủ như văn bản ticket viết** (B4): AC9 mở
đầu bằng "Khi một request tới `api` đẩy một job vào hàng đợi" — tiền đề này
không xảy ra được với code hiện tại vì 3/4 điểm đẩy job ở trên là stub, nên
chặng "request → enqueue" không có gì để test. Thiết kế vẫn dựng đủ phần
D11 (hợp đồng `job.data.correlationId`, 3 processor đọc + bọc context log,
fallback UUID v4) và chứng minh bằng test enqueue trực tiếp (xem AC9 ở
§10), nhưng đó là bằng chứng ở tầng processor, không phải bằng chứng "request
đẩy job" mà AC9 mô tả. Đây là quyết định phạm vi/nghiệm thu, không phải
quyết định kỹ thuật — xem mục `OPEN(BA)` dưới `## OPEN items`.

## 6. `web` — AC8 forward correlationId khi SSR

`apps/web/src/middleware.ts` chạy Next.js Middleware — mặc định **Edge
Runtime** (không có `export const runtime = "nodejs"` trong file, và
`apps/web/src/lib/logger.ts` dùng `pino({ browser: {...} })` — chế độ
"browser" của Pino chính là để tránh gọi Node transport API, dấu hiệu code đã
viết cho môi trường không đầy đủ Node API). Đây là lý do `generateCorrelationId()`
ở §4 dùng `globalThis.crypto.randomUUID()` thay vì `import { randomUUID }
from "node:crypto"`.

Import từ subpath `@myflix/shared/correlation-id` (B2), **không** từ barrel
`@myflix/shared`: `packages/shared/src/index.ts` re-export `./password`, và
file đó `import … from "@node-rs/argon2"` — native addon không chạy được
trên Edge Runtime. `correlation-id.ts` không có dependency nào, nên subpath
export mới thêm ở §4 (`packages/shared/package.json#exports`) tách nó khỏi
graph của `password.ts`/argon2 hoàn toàn.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { resolveCorrelationId } from "@myflix/shared/correlation-id";
import { logger } from "./lib/logger";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const correlationId = resolveCorrelationId(request.headers.get("x-correlation-id"));
  logger.info({ msg: "request", method: request.method, path: pathname, correlationId });

  const hasSession = request.cookies.has("refresh_token");
  const hasProfile = request.cookies.has("pid");
  if (!hasSession) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  if (!hasProfile && pathname !== "/profiles") {
    return NextResponse.redirect(new URL("/profiles", request.url));
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-correlation-id", correlationId);
  return NextResponse.next({ request: { headers: forwardedHeaders } });
}
```

Nhánh redirect không cần forward (không có Server Component nào render/gọi
`api` trên response redirect — trình duyệt tự issue request mới tới
`Location`), nhưng dòng log ở đầu hàm đã chạy cho **mọi** request bất kể
nhánh nào, đủ cho NFR "phủ correlationId".

`NextResponse.next({request:{headers}})` set `x-middleware-request-<key>` và
`x-middleware-override-headers` lên response trả về — cơ chế nội bộ xác nhận
từ chính source Next.js (`handleMiddlewareField`,
`turbopack-ecmascript/tests/tree-shaker` @ v15.1.8), Next runtime dùng các
header này để dựng lại request đi tiếp tới Server Component. `headers()` (từ
`next/headers`) trong Server Component đọc lại được giá trị đó — cùng cơ chế
tài liệu Next.js dùng cho ví dụ CSP nonce (`x-nonce` set ở middleware, đọc lại
bằng `headers()` trong Server Component).

`apps/web/src/lib/api-client.ts`:

```ts
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const correlationId = await resolveServerCorrelationId();
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(correlationId ? { "X-Correlation-Id": correlationId } : {}),
      ...init.headers,
    },
  });
  // ... phần còn lại giữ nguyên
}

async function resolveServerCorrelationId(): Promise<string | undefined> {
  if (typeof window !== "undefined") return undefined; // browser: bỏ qua, nginx route thẳng tới api
  try {
    const { headers } = await import("next/headers"); // dynamic import: giữ next/headers ngoài bundle client
    return (await headers()).get("x-correlation-id") ?? undefined;
  } catch {
    return undefined; // ngoài request scope (test, script) — headers() ném lỗi, không phải bug
  }
}
```

**S7 — bằng chứng bắt buộc cho AC8.** `apps/web/src/components/player/player-shell.tsx`
(`"use client"`) import `apiFetch` từ file này, nên `api-client.ts` nằm
trong graph client dù guard `typeof window` chỉ có tác dụng lúc runtime;
bundler có thể vẫn thấy `next/headers` trong graph đó ở build time. Task
AC8 **bắt buộc** chạy `pnpm --filter web build` xanh làm bằng chứng — nếu
build lỗi (không tree-shake được `import("next/headers")` khỏi bundle
client), tách một wrapper server-only mới (ví dụ `apps/web/src/lib/api-server.ts`,
chỉ import bởi Server Component/route handler) giữ `resolveServerCorrelationId`
+ `next/headers`, và để `apps/web/src/lib/api-client.ts` (import được từ cả
client lẫn server) không đụng `next/headers` — gọi bằng cách khác (ví dụ
tham số `correlationId?: string` truyền từ caller server-side) hoặc bỏ
default value đó ở nhánh client-safe.

`apps/web/src/lib/logger.ts`: **không đổi** (bỏ ý định thêm
`redact: LOG_REDACT_CONFIG` — B2/N2). `pino/browser.js` (build browser của
Pino mà `logger.ts` đang dùng qua chế độ `browser: {...}`, và cũng là bản
mà vitest alias `pino → pino/browser`) không hỗ trợ option `redact` — thêm
dòng đó không có tác dụng thật, chỉ tạo thêm một import `@myflix/shared`
(barrel) trong file mà `middleware.ts` (Edge) cũng import, làm lại đúng vấn
đề B2 vừa sửa. `web` hiện không log header nào nên D10 (redact 3 app) không
có gì để áp dụng ở `logger.ts` lúc này; ghi nhận là giới hạn của D10 trên
`web`, không phải thiếu sót.

## 7. `transcoder` — GPU probe HTTP listener (mission D7)

`apps/transcoder/src/main.ts` — đổi `createApplicationContext` (headless)
thành `create` (có HTTP), cập nhật comment đầu file cho khớp:

```ts
const GPU_PROBE_PORT = 4100; // mission D7 — chỉ nội bộ mạng compose, không publish ra host

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(GPU_PROBE_PORT, "0.0.0.0");
}
```

Cần `@nestjs/platform-express` — **thêm vào `apps/transcoder/package.json`
dependencies** (`^11.0.0`, khớp bản `api` đang dùng); `NestFactory.create()`
cần một HTTP adapter, hiện transcoder không có adapter nào cài. Sau khi sửa
`package.json`, chạy `pnpm install` để cập nhật `pnpm-lock.yaml` — bắt buộc
vì `ci.yml` dùng `pnpm install --frozen-lockfile`.

`apps/transcoder/src/health/gpu-probe.service.ts` [NEW: D7] — tái dùng đúng
pattern `setInterval` + `unref()` đã có ở `MaintenanceService`:

```ts
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
    this.timer = setInterval(() => void this.runCheck(), GPU_CHECK_INTERVAL_MS);
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

`apps/transcoder/src/health/gpu-probe.controller.ts` [NEW: D7]:

**NS2 — không dùng `@Res`/`Response`.** `apps/transcoder/package.json`
không có `express` hay `@types/express` (không có `@nestjs/platform-express`
ở dependencies trước §7; ngay cả sau khi §7 thêm nó, gói đó không kèm theo
type `express` — phải khai `@types/express` riêng, việc này ngoài phạm vi
D7). `import type { Response } from "express"` sẽ lỗi TS2307, `nest build`
đỏ. Dùng `ServiceUnavailableException` (`@nestjs/common`, có sẵn qua
`@nestjs/platform-express` mới thêm ở §7) để trả 503 — Nest tự set status
code từ exception, không cần `@Res`:

```ts
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type GpuState = "ok" | "not_required" | "down"; // transcoder tự trả 3/4 giá trị — "unreachable" là diễn giải phía api

@Controller("health")
export class GpuProbeController {
  constructor(private readonly config: ConfigService, private readonly probe: GpuProbeService) {}

  @Get("gpu")
  check(): { gpu: GpuState } {
    const encoder = this.config.get<string>("TRANSCODE_ENCODER", "h264_nvenc");
    if (!encoder.endsWith("_nvenc")) return { gpu: "not_required" }; // Q3/D7 — nhánh CPU

    if (this.probe.read()) return { gpu: "ok" };
    throw new ServiceUnavailableException({ gpu: "down" }); // body {"gpu":"down"} + HTTP 503, đúng D7
  }
}
```

`apps/transcoder/src/health/health.module.ts` [NEW: D7] — `controllers:
[GpuProbeController], providers: [GpuProbeService]`, thêm vào
`AppModule.imports`. `TRANSCODE_ENCODER` đã có sẵn trong
`apps/transcoder/src/config/env.ts` (`z.string().default("h264_nvenc")`) —
không cần sửa schema đó.

## 8. `docker-compose.yml` / test override / `.env.example`

`services.api`:
- `healthcheck.timeout: 5s → 3s`, `retries: 10 → 3` (mission D8/Q14; giữ
  nguyên `interval: 10s`, `start_period: 40s` — mission không quyết đổi 2 giá
  trị này).
- `environment`: **không đổi** (B3) — D7 nói rõ "không thêm env key mới cho
  `api`"; URL GPU probe là hằng số trong code (`health.controller.ts` §3),
  không qua biến môi trường.

`services.transcoder`: thêm `expose: ["4100"]` — không bắt buộc về mạng
(container cùng network compose gọi nhau theo tên service bất kể có `expose`
hay không), nhưng khớp dominant style của repo (`postgres`/`redis` đều khai
`expose` dù lý do tương tự) — ghi nhận dưới `## Findings` là theo style, không
phải yêu cầu kỹ thuật. **Không thêm `ports:`** ra host (B3/D7: "cổng 4100
chỉ trong mạng compose").

`infra/compose/docker-compose.test.yml`: **không đổi** (B3) — không publish
`4100:4100` ra host. `health.e2e-spec.ts` chạy trong tiến trình Jest trên
host không có route tới `transcoder:4100` (tên DNS chỉ phân giải được trong
mạng compose) nên `checks.gpu` sẽ luôn là `"unreachable"` khi chạy trên
host — test được viết để chỉ kiểm hợp đồng (`gpu` là 1 trong 4 giá trị hợp
lệ), không kiểm giá trị cụ thể (xem AC1 ở §10 và Finding 5). Trạng thái GPU
thật (`"ok"`/`"down"`) chỉ quan sát được từ bên trong mạng compose — bằng
chứng là T4/T4b (`docker compose exec api curl transcoder:4100/health/gpu`
hoặc tương đương) và `verify-phase0.sh` chạy trong compose, không phải
`health.e2e-spec.ts` trên host.

`.env.example`: **không đổi** (B3) — không có biến `TRANSCODER_HEALTH_URL`
nào cần thêm, nên bất biến "số biến `.env.example` khớp union `env_keys`"
(US1 AC22) không bị động tới bởi US2.

## 9. `scripts/verify-phase0.sh` (US1 AC27)

Đọc lại toàn bộ script: subcheck `"api /health"` chỉ gọi
`fetch(...).then(r=>{if(!r.ok)process.exit(1)})` — không hard-code
`timeout`/`retries`; subcheck `"7 services healthy"` chỉ đếm nhãn `healthy`
từ `docker compose ps`, không đọc cấu hình healthcheck. **Không có dòng nào
trong file này cần sửa nội dung** để phản ánh D8's `timeout: 3s`/`retries:
3`. Nghĩa vụ AC27 ("mọi thay đổi `docker-compose.yml` phải cập nhật
`scripts/verify-phase0.sh` trong cùng commit và chạy lại, script xanh là điều
kiện merge" — ticket US1 AC27) được thoả bằng cách **chạy lại** script trong
cùng PR (T1, T4c) làm bằng chứng hồi quy, không phải bằng một diff nội dung
— ghi rõ dưới `## Findings` để tránh hiểu nhầm là bỏ sót.

## 10. AC-by-AC

| AC | Cơ chế | Test | Cách thấy test FAIL trước |
|---|---|---|---|
| AC1 | `HealthController.check` — 4 check song song, body có `postgres/redis/minio/gpu` | `health.controller.spec.ts` [NEW] — mock 4 dependency `ok`, assert `status 200`, đủ 4 tên khoá; `health.e2e-spec.ts` [MOD, **viết lại toàn bộ** — S8] bỏ `.expect(200)` cứng và assertion `res.body.queue` (field không còn tồn tại), thay bằng assert `checks.postgres/redis/minio === "ok"`, `checks.gpu` thuộc 4 giá trị `GpuState` hợp lệ, và `res.status` khớp `res.body.status` (`200` khi `"ok"`, `503` khi `"degraded"`) — đúng cả khi chạy trên host (`gpu` luôn `"unreachable"`, xem §8) lẫn trong compose; T1 qua stack thật xác nhận 200 khi cả 4 sống | Test viết trước khi sửa controller: import `HealthController` hiện tại, `checks` object chỉ có `postgres/redis` → assertion "4 khoá" fail ngay (thiếu `minio`,`gpu`) |
| AC2 | `probe()`/`probeGpu()` trả `"fail"`/`"down"`/`"unreachable"` độc lập; `healthy` false khi bất kỳ 1 sai | `health.controller.spec.ts` — 4 case: mock lần lượt postgres/redis/minio reject, gpu `down`; assert 503 + đúng field sai, 3 field còn lại `"ok"` | Viết case "redis reject → checks.redis==='fail', checks.postgres==='ok'" trước khi có `checks.minio`/`checks.gpu` trong return — compile fail vì field chưa tồn tại (RED hợp lệ) |
| AC3 | `withTimeout()` (`Promise.race`, 1.000 ms) bọc cả 4 | `health.controller.spec.ts` — mock 1 dependency `Promise` không bao giờ resolve, dùng Jest fake timers, assert `check()` resolve trong `CHECK_TIMEOUT_MS` và trả `"fail"`/`"unreachable"`; compose-level T5 (`docker compose pause redis`, đo `time_total` ≤ 1.5s) | Test hiện tại gọi `probe()` cũ (không có timeout) với 1 promise treo mãi → test tự treo/timeout Jest, không resolve trong ngân sách — chứng minh thiếu timeout trước khi thêm `withTimeout` |
| AC4 | `probe`/`probeGpu` không bao giờ đưa exception gốc vào body | `health.controller.spec.ts` — mock reject với `Error("ECONNREFUSED 10.0.0.1:5432 password=x")`, assert `JSON.stringify(result)` không chứa `ECONNREFUSED`/`5432`/`password`; thêm case `probeGpu`: transcoder trả body `{ gpu: "ECONNREFUSED 10.0.0.1:4100" }` (chuỗi lạ, không phải 1 trong 4 giá trị `GpuState`) → assert `checks.gpu === "unreachable"`, không phải chuỗi lỗi đó; compose-level T6 | `probe()` cho postgres/redis/minio **đã đúng sẵn** trên code hiện tại (`try/catch` trả `"fail"`, `health.controller.ts:47-54` @ be262b5) — không có RED thật cho phần đó, đây là characterization test (S1). RED thật nằm ở `probeGpu`: viết case body `{ gpu: <chuỗi lạ> }` trước khi có dòng ép `gpu === "ok" \|\| gpu === "not_required" ? gpu : "unreachable"` → code cũ (chưa có `probeGpu`) không tồn tại hàm này, RED là "hàm chưa tồn tại"; sau khi thêm hàm nhưng thiếu dòng ép enum, RED là trả nguyên chuỗi lạ thay vì `"unreachable"` |
| AC5 | `genReqId` (export riêng — S2) chấp nhận header hợp lệ, set vào `req.id`; `customAttributeKeys` + `quietReqLogger: true` đổi tên `reqId`→`correlationId` trong log (NB1); `res.setHeader` echo | `apps/api` — unit test `resolveCorrelationId` (packages/shared) cho input hợp lệ trả nguyên giá trị; unit test `genReqId(reqStub, resStub)` [NEW, S2] — gọi trực tiếp với `res` giả (`jest.fn()` cho `setHeader`), assert `resStub.setHeader` được gọi với `("X-Correlation-Id", "t7-probe-0001")`; unit test `pinoHttp` config [NEW, NB1, sửa theo R3-S2] — import `PINO_HTTP_OPTIONS` từ `./logger.options` (R4-S1, không dựng literal riêng — R3-S2), dựng `pinoHttp({ ...PINO_HTTP_OPTIONS, genReqId: () => "t7-probe-0001" }, memStream)`, chạy 1 request HTTP thật qua `http.createServer` có handler gọi thêm `req.log.info("in-request")` (phủ cả dòng log phát ra TRONG khi xử lý request, không chỉ dòng `request completed`), parse các dòng log JSON từ `memStream`, assert **mọi** dòng có `correlationId === "t7-probe-0001"`; e2e T7 (gửi header, grep log + đọc response header) | `genReqId` hiện tại **đã** nhận `x-correlation-id` và **đã** gắn `correlationId` vào mọi dòng log (`app.module.ts:30-32` @ be262b5) — không phải RED thật (S2). Phần thật sự thiếu là echo header vào response: test gọi `genReqId(reqStub, resStub)` trước khi có dòng `res.setHeader(...)` trong hàm → `resStub.setHeader` không được gọi, assertion `toHaveBeenCalledWith(...)` fail — RED thật. Riêng test `pinoHttp` config [NB1, R3-S2]: chạy trước khi `quietReqLogger: true` có trong `PINO_HTTP_OPTIONS` → dòng log không có trường `correlationId` nào → assertion fail — RED thật cho chính option NB1 sửa; và vì test import thẳng `PINO_HTTP_OPTIONS`, nếu sau này ai đó xoá `quietReqLogger: true` khỏi `logger.options.ts` (lặp lại hồi quy NB1) thì cùng test này đỏ lại ngay, không còn là literal tách rời khỏi cấu hình thật (khắc phục đúng lỗ hổng R3-S2 nêu) |
| AC6 | Thiếu header → `generateCorrelationId()` (UUID v4); response header "với **mọi** mã HTTP, 2xx, 4xx lẫn 5xx" (ticket AC6, nguyên văn) — gồm cả lớp lỗi body-parser qua fallback mới trong `AllExceptionsFilter.catch` (R3-S4, xem cuối §4) | `correlation-id.test.ts` [NEW] — `resolveCorrelationId(undefined)` khớp regex UUID v4; e2e T8, T9 (ép lỗi 500, vẫn có header); e2e mới [NEW, R3-S4] — `beforeAll` gọi `app.useGlobalFilters(app.get(AllExceptionsFilter))` trước `app.init()`, giống `main.ts:22` (R4-S2), rồi gửi body JSON hỏng (`Content-Type: application/json`, body cắt cụt) tới 1 route có body → assert `400` và có header `X-Correlation-Id` khớp UUID v4 | `resolveCorrelationId(undefined)` gọi trước khi hàm tồn tại → RED (module not found); sau khi có hàm nhưng generator dùng `Math.random` thay UUID thật → assertion regex UUID v4 fail; case JSON hỏng [R3-S4] chạy trước khi có fallback trong `catch()` → response 400 không có header `X-Correlation-Id` (body-parser bypass `pino-http`, `req.id` rỗng) → assertion header fail — RED thật (harness phải đã đăng ký `AllExceptionsFilter` — R4-S2 — nếu không, test vẫn đỏ sau khi sửa `catch()` vì response đi qua `BaseExceptionFilter` mặc định) |
| AC7 | `isValidCorrelationId` đúng regex `^[A-Za-z0-9._-]{1,64}$`; giá trị sai bị bỏ, không lọt vào log dưới khoá `correlationId` | `correlation-id.test.ts` — case 65 ký tự, case chứa `\n`/khoảng trắng → cả hai phải sinh giá trị mới; e2e T10 (grep log, giá trị gửi lên 0 lần xuất hiện) | Case 65 ký tự chạy trước khi có regex (hàm chỉ check `typeof === "string"`) → trả nguyên giá trị 65 ký tự thay vì sinh mới — assertion length fail |
| AC8 | `middleware.ts` set `x-correlation-id` vào request headers forward (import từ `@myflix/shared/correlation-id` — B2); `api-client.ts` đọc qua `next/headers` khi SSR | `middleware.test.ts` [MOD] — case mới: gửi `X-Correlation-Id` hợp lệ, assert `response.headers.get("x-middleware-request-x-correlation-id")` bằng đúng giá trị; `api-client.test.ts` [MOD] — mock `next/headers`, assert `fetch` nhận `X-Correlation-Id`; compose-level T11; **bắt buộc `pnpm --filter web build` xanh** (S7) làm bằng chứng Edge bundle của `middleware.ts` không kéo `@node-rs/argon2` và client bundle chứa `player-shell.tsx`→`api-client.ts` không kéo `next/headers` — nếu đỏ, tách `apps/web/src/lib/api-server.ts` (xem §6) | Test middleware đọc header forward trước khi middleware set `x-correlation-id` vào `requestHeaders` (code cũ chỉ redirect/next không sửa header) → `x-middleware-request-x-correlation-id` là `undefined`, assertion fail. Test api-client trước khi `resolveServerCorrelationId` tồn tại → fetch call không có header đó, `toHaveBeenCalledWith` fail |
| AC9 | `job.data.correlationId` đọc qua `resolveCorrelationId`, bọc `storage.run(new Store(PinoLogger.root.child(...)))`; xem §5/`OPEN(BA)` cho giới hạn "request → enqueue" của T12; xem NS1 dưới đây cho harness bắt buộc của test | `apps/transcoder/src/jobs/transcode.processor.spec.ts` [NEW] — gọi `processor.process(fakeJob)` **trực tiếp** (không qua `Queue.add`/Redis thật — khớp jest unit `rootDir: src` của `transcoder`, không có hạ tầng Redis) với `prisma`/`storage`/`ffmpeg`/`keyframes`/`events`/`config` mock và `fakeJob.data.correlationId: "t12-probe-0001"`; job fail ở bước chưa implement (chấp nhận được) nhưng trước tiên assert bằng chứng có mặt bắt buộc `logs.length >= 3` và chứa đủ 3 message `"job started"`, `"staging cleanup failed"`, `"job finished"` (R3-S1 — tránh assertion sau pass vô nghĩa khi `logs` rỗng), rồi mới assert MỌI log line phát ra trong lúc xử lý — **kể cả dòng `warn` trong `finally`** — mang `correlationId` đó, đọc từ `memStream` (xem harness NS1/R3-S1 dưới đây, **không** spy `PinoLogger`); T12b — gọi `processor.process(fakeJob)` với `fakeJob.data` không có `correlationId` (mô phỏng job "drain" của `MaintenanceService`), assert log mang **1** UUID v4 mới | **Harness bắt buộc trước khi RED có ý nghĩa (NS1)**: `PinoLogger.root` chỉ được `LoggerModule.forRoot()` gán khi Nest gọi `configure()` lúc `app.init()`/`app.listen()` thật (`LoggerModule.js` `createLoggerMiddlewares`) — một test tạo `processor` bằng mock thủ công (không dựng `NestApplication` đầy đủ) sẽ thấy `PinoLogger.root === undefined`. Vì vậy `beforeEach` phải tự dựng lại `outOfContext`/`root` bằng API có sẵn — **không** `import pino from "pino"` (R3-S1: `pino` không phải dependency trực tiếp của `apps/transcoder`/`apps/api`/`packages/shared`, chỉ `nestjs-pino`/`pino-http` có trong `package.json`; xác minh trên máy này: `apps/transcoder/node_modules` chỉ có `nestjs-pino`, `pino-http`, không có `pino` — `require.resolve('pino')` từ `apps/transcoder/src` MISSING; đã đọc `node_modules/nestjs-pino/index.js@4.6.1` xác nhận **không** re-export `pino`), mà dùng `pino-http` (`^10.3.0`, dependency trực tiếp sẵn có ở cả `api` lẫn `transcoder`) để dựng cả `outOfContext` lẫn `root` cùng trỏ vào `memStream`: `__resetOutOfContextForTests()` (export ở `nestjs-pino/PinoLogger`, deep-import hợp lệ như `nestjs-pino/storage` — không có trường `exports` trong `package.json`) reset cả 2 state module-private (`outOfContext` VÀ `PinoLogger.root`); `new PinoLogger({ pinoHttp: [{}, memStream] })` gán lại `outOfContext` để log phát **ngoài** `storage.run` (ví dụ Nest's built-in `Logger` trước khi job nào chạy) cũng vào `memStream` thay vì lọt ra stdout; `(PinoLogger as unknown as { root: ReturnType<typeof pinoHttp>["logger"] }).root = pinoHttp({}, memStream).logger;` gán `root` — không cần dựng `NestApplication`/`Test.createTestingModule().compile()` (`compile()` không gọi `configure()`). Thiếu bước này, `processor.process(fakeJob)` ném `TypeError: Cannot read properties of undefined (reading 'child')` ngay tại `PinoLogger.root.child(...)` — lỗi này **không phải** RED hợp lệ cho AC9 (nó fail vì thiếu harness, không phải vì thiếu hành vi), nên phải dựng harness trên trước rồi mới viết case RED thật. RED thật (sau khi có harness): mock `storage.deletePrefix` reject → dòng `this.logger.warn({ err: error, jobId }, "staging cleanup failed")` (`transcode.processor.ts:82` @ be262b5) hiện chạy **ngoài** mọi bọc context, không mang `correlationId` → assertion "mọi dòng trong `logs` mang `t12-probe-0001`" fail trước khi bọc toàn thân `process()` trong `storage.run(...)` (S3 — RED cũ dựa vào `runInContext` không tồn tại và lẫn với case cron/A8, không phải RED thật cho AC9) |
| AC10 | `LOG_REDACT_CONFIG` (`authorization`,`cookie`,`res.headers["set-cookie"]` → `[REDACTED]`); pino-http mặc định không log body (không cấu hình gì thêm) | Unit, đặt ở `apps/api` [R3-S3 — không "tạo 1 pino instance" bằng `import pino from "pino"`: `pino` không resolve được từ `apps/api`/`apps/transcoder`/`packages/shared`, chỉ `pino-http` là dependency trực tiếp]: dựng `pinoHttp({ ...PINO_HTTP_OPTIONS, genReqId: () => "t13-probe-0001" }, memStream)` (dùng chung `PINO_HTTP_OPTIONS` với test AC5, import từ `./logger.options` — R4-S1, R3-S2/R3-S3 gộp harness), chạy 1 request HTTP thật qua `http.createServer` có header `Cookie`/`Authorization` và response set `Set-Cookie`, parse dòng `request completed` từ `memStream`, assert cả 3 path (`req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`) đều là `[REDACTED]` và giá trị gốc không xuất hiện — phủ đúng `res.headers["set-cookie"]` qua serializer thật, không giả lập; compose-level T13 (đăng nhập, grep log 3 service tìm mật khẩu/token/`refresh_token`, đếm dòng có field `body`) | Test dùng `redact` cũ (chỉ 2 path, thiếu `set-cookie`) trước khi đổi sang `LOG_REDACT_CONFIG` — log response có `Set-Cookie: refresh_token=...` xuất hiện nguyên văn → assertion "chứa `[REDACTED]`" fail |

## Findings for the PR

1. **`packages/shared/src/dto/ingest.ts`** — `TranscodeJobData.correlationId`
   đã tồn tại sẵn (bắt buộc, `string`) từ trước ticket này, đã có comment
   trích NFR-46/DoD-6-2 — không cần sửa DTO này, chỉ 3 processor tiêu thụ nó
   thay đổi.
2. **KB mismatch với code (Q9) — AC9 nghiệm thu một phần, xem `OPEN(BA)`**:
   3/4 điểm đẩy job KB/ticket gợi ý (`ingest.service.ts`, `admin-ops.service.ts`,
   `admin-subtitles.service.ts`) đều là `NotImplementedException` stub Phase 1
   — chưa có lệnh `.add()` thật nào để US2 sửa. Chỉ `maintenance.service.ts:61`
   (`cleanup.add("drain", {}, ...)`) đang chạy thật, và nó là job cron không
   có `correlationId` theo đúng thiết kế (A8). Do đó T12 ("khởi động một
   upload tạo job transcode") **không chạy được với code hiện tại** — thay
   bằng test enqueue trực tiếp qua `processor.process(fakeJob)` (xem AC9 ở
   bảng trên), chứng minh cơ chế D11 (`job.data.correlationId` + 3 processor
   đọc + fallback UUID v4) mà không cần ingest hoàn tất. Đây **là** một AC
   không nghiệm thu được đầy đủ như văn bản ticket viết — test thay thế
   chứng minh cơ chế, không chứng minh chặng "request → enqueue" mà AC9 mô
   tả. Quyết định chấp nhận bằng chứng này hay dời sang ticket ingest thuộc
   về BA — xem `OPEN(BA)` dưới `## OPEN items`.
3. **`scripts/verify-phase0.sh`** không có nội dung cần sửa cho thay đổi D8
   (xem §9) — nghĩa vụ AC27 thoả bằng cách chạy lại script trong cùng PR,
   không phải một diff.
4. **`web` middleware chạy Edge Runtime** (suy luận từ việc không có `export
   const runtime = "nodejs"` và `logger.ts` dùng chế độ `browser` của Pino) —
   quyết định dùng `globalThis.crypto.randomUUID()` thay vì `node:crypto`
   trong `packages/shared/src/correlation-id.ts` xuất phát từ quan sát này,
   không phải từ mission D9 (D9 chỉ nói "`crypto.randomUUID()`", không nói
   import path) — ghi nhận vì đây là một diễn giải kỹ thuật, không phải trích
   dẫn trực tiếp.
5. **`api.checks.gpu` sẽ luôn là `"unreachable"` khi `health.e2e-spec.ts`
   chạy trên host** (Jest import `AppModule` trực tiếp trong tiến trình host,
   không phải trong container `api`; `transcoder` là tên DNS chỉ phân giải
   trong mạng compose, và B3 bỏ hẳn việc publish cổng 4100 ra host — không có
   đường nào để tiến trình Jest trên host chạm `transcoder` thật). Vì vậy
   `health.e2e-spec.ts` (viết lại toàn bộ — S8, xem AC1 ở §10) chỉ assert
   `checks.postgres/redis/minio === "ok"` cụ thể và `checks.gpu` là 1 trong 4
   giá trị hợp lệ (kiểm hợp đồng, không kiểm giá trị cụ thể) — tránh test
   flaky theo môi trường chạy. Trạng thái GPU thật chỉ quan sát được từ bên
   trong mạng compose (T4/T4b, `verify-phase0.sh`).
6. **D11 — cơ chế thật khác chữ "logger.child" của mission text (B1)**:
   `nestjs-pino@4.6.1` (bản đang pin, không có trường `exports` trong
   `package.json`) không có `PinoLogger.runInContext` (chỉ có ở 5.x, đòi
   nâng major `pino`/`pino-http` — ngoài phạm vi ticket); `PinoLogger.assign()`
   cũng không dùng được ngoài request scope. Cơ chế thật dùng đúng API sẵn có
   ở 4.6.1: `storage.run(new Store(PinoLogger.root.child({ correlationId })), fn)`
   (deep import `nestjs-pino/storage`) bọc thân mỗi `process()`. Kết quả
   tương đương — mọi dòng log trong lúc xử lý job mang `correlationId`, kể cả
   log phát từ service khác qua Nest's `Logger` built-in (route qua cùng
   `PinoLogger.logger` getter) — nhưng cơ chế không phải một lệnh `.child()`
   gọi trực tiếp như văn bản D11 paraphrase.
7. **D9 — theo nguyên văn, cộng `quietReqLogger: true` (NB1)**: dùng
   `customAttributeKeys: { reqId: "correlationId" }` (đúng chữ D9, kiểu
   `CustomAttributeKeys` có trong `pino-http@10.5.0`) thay `customProps` của
   code cũ (S6) — nhưng `customAttributeKeys` một mình **không** làm trường
   `correlationId` xuất hiện trong log (xác minh thực nghiệm ở §4: khoá đổi
   tên chỉ được dùng khi `quietReqLogger: true`), nên phải thêm tuỳ chọn đó.
   **Sửa lại tiền đề sai của bản trước**: code cũ (`customProps: (req) => ({
   correlationId: req.id })`) **không** tạo trường `reqId` trùng lặp cạnh
   `correlationId` — xác minh thực nghiệm cho thấy code cũ chỉ có
   `correlationId` ở cấp trên cùng, không có `reqId` nào khác. Lý do đổi
   sang `customAttributeKeys` vì vậy chỉ là bám nguyên văn D9 (D9 chỉ nói
   "`customAttributeKeys`"), không phải để loại bỏ một trường trùng lặp
   không có thật.
8. **Naming**: file mới `apps/transcoder/src/health/` đặt tên
   `gpu-probe.controller.ts`/`gpu-probe.service.ts`/`health.module.ts`, khác
   với gợi ý duy nhất trong Technical grounding
   (`gpu-probe.controller.ts` — không nêu tên service/module) — theo đúng
   pattern `apps/api/src/health/` đã có (controller + module), thêm service
   vì logic polling cần tách khỏi HTTP handler.
9. **Quy ước**: không phát hiện xung đột giữa `docs/conventions/ts.md`
   (base) và style thật của repo — `ts.local.md` rỗng (chỉ có template),
   không có deviation nào cần ghi.
10. **D10 không áp cho `web` (NS3a)**: mission D10 nói `log-redact.ts` "dùng
    cho cả `api`, `web`, `transcoder`", nhưng thiết kế này **không** thêm
    `redact: LOG_REDACT_CONFIG` vào `apps/web/src/lib/logger.ts` (§6) — lý do
    kỹ thuật: `pino/browser.js` (build mà `logger.ts` dùng qua chế độ
    `browser: {...}`, cũng là bản `vitest` alias `pino → pino/browser`)
    không hỗ trợ option `redact`; thêm dòng đó không có tác dụng thật, chỉ
    tạo lại đúng vấn đề B2 (kéo barrel `@myflix/shared` vào file mà
    `middleware.ts` Edge cũng import). `web` hiện không log header nào nên
    không có gì để redact ở `logger.ts` lúc này. Đây là một độ lệch so với
    D10 có lý do kỹ thuật, không phải thiếu sót.
11. **`expose: ["4100"]` cho `transcoder` (NS3b)**: thêm ở §8 theo dominant
    style của repo (`postgres`/`redis` đều khai `expose`), **không** bắt
    buộc về kỹ thuật — container cùng network compose gọi nhau theo tên
    service bất kể có `expose` hay không. Không thêm `ports:` ra host
    (B3/D7).

## OPEN items

- **OPEN(BA) — AC9 nghiệm thu bằng bằng chứng ở tầng processor, không phải
  "request đẩy job"**: các điểm đẩy job mà ticket nêu tên
  (`IngestService.complete`, `AdminOpsService.retryJob`,
  `AdminSubtitlesService.upload`) đều là stub `NotImplementedException` tại
  `be262b5`, nên "request tới `api` đẩy job vào hàng đợi" (mở đầu AC9) không
  chạy được end-to-end trong ticket này. Thiết kế vẫn dựng đủ phần plumbing
  D11 — hợp đồng `job.data.correlationId`, 3 processor đọc và log nó qua
  `storage.run` + `PinoLogger.root.child`, fallback UUID v4 mới khi thiếu —
  và chứng minh bằng test enqueue trực tiếp (`processor.process(fakeJob)`,
  xem AC9 ở §10). BA quyết định: (a) chấp nhận nghiệm thu AC9 bằng bằng
  chứng test processor này, dời T12 ("khởi động một upload…") sang ticket
  ingest Phase 1; hoặc (b) giữ AC9 bị chặn tới khi ticket ingest xong.

## Review record

| Date | Round | Verdict | Reviewer | Open gaps |
|---|---|---|---|---|
| 2026-09-29 | 1 | BLOCKER x4, SUGGESTED x8 | design-reviewer | B1–B4, S1–S8 applied by fix subagent; NOTE x6, NITS x4 recorded |
| 2026-09-29 | 2 | BLOCKER x1, SUGGESTED x4 | design-reviewer | NB1, S4, NS1, NS2, NS3 applied by fix subagent; NOTE x3, NITS x5 recorded |
| 2026-09-29 | 3 | SUGGESTED x4 | design-reviewer | R3-S1, R3-S2, R3-S3, R3-S4 still open after round 3 — flow stopped, Dev decides; NOTE x1, NITS x2 recorded |
| 2026-09-29 | 3→fix | — | fix subagent | R3-S1..S4 applied (round 4 authorised by Dev, option 1) |
| 2026-09-29 | 4 | SUGGESTED x3 | design-reviewer | R4-S1, R4-S2, R4-S3, R4-T1 applied by fix subagent (round authorised by Dev, option 1) |
| 2026-09-29 | 5 | clean (0 BLOCKER, 0 SUGGESTED) | design-reviewer | NOTE x1 (R5-N1 → unit test of AllExceptionsFilter fallback, carry to plan/PR), NITS x2 recorded; round authorised by Dev, option 1 |
