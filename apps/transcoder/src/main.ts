import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * Headless worker: no HTTP listener, nothing exposed. It exists only to drain
 * BullMQ queues, so state lives entirely in Postgres and Redis and the
 * process can be killed and restarted at any moment (principle P-4).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

void bootstrap();
