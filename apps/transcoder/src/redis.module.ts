import { Global, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS = "REDIS";

export const createRedisClient = (config: ConfigService): Redis => {
  const client = new Redis({
    host: config.getOrThrow<string>("REDIS_HOST"),
    port: config.getOrThrow<number>("REDIS_PORT"),
    maxRetriesPerRequest: null,
  });
  client.on("error", (err: Error) => new Logger("Redis").error(err.message)); // T14 / mission D10 — không có listener thì ioredis in "[ioredis] Unhandled error event" thẳng ra stdout, phá "mọi dòng log là JSON"
  return client;
};

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: createRedisClient,
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
