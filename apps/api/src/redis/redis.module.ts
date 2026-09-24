import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export const REDIS = "REDIS";
/** Subscriber connections cannot issue normal commands, so pub/sub needs its
 *  own client alongside the command one. */
export const REDIS_SUBSCRIBER = "REDIS_SUBSCRIBER";

const factory = (config: ConfigService) =>
  new Redis({
    host: config.getOrThrow<string>("REDIS_HOST"),
    port: config.getOrThrow<number>("REDIS_PORT"),
    maxRetriesPerRequest: null,
  });

@Global()
@Module({
  providers: [
    { provide: REDIS, useFactory: factory, inject: [ConfigService] },
    { provide: REDIS_SUBSCRIBER, useFactory: factory, inject: [ConfigService] },
  ],
  exports: [REDIS, REDIS_SUBSCRIBER],
})
export class RedisModule {}
