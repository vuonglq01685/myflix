import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

jest.mock("ioredis", () => ({
  __esModule: true,
  default: class extends EventEmitter {
    constructor(public opts: unknown) {
      super();
    }
  },
}));

import { createRedisClient } from "./redis.module";

describe("createRedisClient", () => {
  afterEach(() => jest.restoreAllMocks());

  it("routes an ioredis error event through the Pino logger instead of letting it hit stdout raw (T14)", () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const config = {
      getOrThrow: (key: string) =>
        ({ REDIS_HOST: "redis", REDIS_PORT: 6379 })[key],
    } as never as ConfigService;

    const client = createRedisClient(config);

    expect(() => client.emit("error", new Error("ECONNREFUSED"))).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith("ECONNREFUSED");
  });
});
