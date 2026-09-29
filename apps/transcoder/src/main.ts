import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

/**
 * Worker that drains BullMQ queues (state lives entirely in Postgres and
 * Redis, so the process can be killed and restarted at any moment —
 * principle P-4) and also exposes a GPU probe HTTP listener on
 * GPU_PROBE_PORT, internal to the compose network only.
 */
const GPU_PROBE_PORT = 4100; // mission D7 — chỉ nội bộ mạng compose, không publish ra host

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.listen(GPU_PROBE_PORT, "0.0.0.0");
}

void bootstrap();
