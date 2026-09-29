import { Global, Logger, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS = "REDIS";
/** Subscriber connections cannot issue normal commands, so pub/sub needs its
 *  own client alongside the command one. */
export const REDIS_SUBSCRIBER = "REDIS_SUBSCRIBER";

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
    { provide: REDIS, useFactory: createRedisClient, inject: [ConfigService] },
    {
      provide: REDIS_SUBSCRIBER,
      useFactory: createRedisClient,
      inject: [ConfigService],
    },
  ],
  exports: [REDIS, REDIS_SUBSCRIBER],
})
export class RedisModule {}
