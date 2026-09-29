import { EventEmitter } from "node:events";
import { Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { BullErrorLogger } from "./bull-error.logger";

function fakeQueue(name: string): Queue {
  return Object.assign(new EventEmitter(), { name }) as unknown as Queue;
}

describe("BullErrorLogger", () => {
  afterEach(() => jest.restoreAllMocks());

  it("routes a Queue error event through the Pino logger instead of a raw stack trace (T14)", () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    const transcode = fakeQueue("transcode");
    const subtitle = fakeQueue("subtitle");
    const cleanup = fakeQueue("cleanup");

    new BullErrorLogger(transcode, subtitle, cleanup).onModuleInit();

    expect(() =>
      subtitle.emit("error", new Error("ECONNREFUSED")),
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ECONNREFUSED"),
    );
  });

  it("throws on an unhandled Queue error event when onModuleInit was never called (T14)", () => {
    const transcode = fakeQueue("transcode");
    const subtitle = fakeQueue("subtitle");
    const cleanup = fakeQueue("cleanup");
    // Constructed but onModuleInit() deliberately not called — proves the
    // listener registered there is what stops EventEmitter's default
    // "unhandled error" throw.
    void new BullErrorLogger(transcode, subtitle, cleanup);

    expect(() => transcode.emit("error", new Error("x"))).toThrow();
  });
});
