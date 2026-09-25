import { describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger — AC18 Pino JSON on stdout", () => {
  it("emits one JSON-parseable line per call via console.log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info({ msg: "request", method: "GET", path: "/browse" });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.msg).toBe("request");
    expect(parsed.path).toBe("/browse");
    expect(typeof parsed.level).toBe("number");
    spy.mockRestore();
  });
});
