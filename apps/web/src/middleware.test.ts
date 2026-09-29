import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { config, middleware } from "./middleware";

// Same shape as crypto.randomUUID() output — mirrors Task 2's
// correlation-id.test.ts (S5); test files don't share a module.
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("middleware — AC18 structured JSON log on every request", () => {
  it('matcher includes the root path (load-bearing: web healthcheck polls "/")', () => {
    expect(config.matcher).toContain("/");
  });

  it("emits one JSON-parseable log line describing the request before any redirect logic runs", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new NextRequest("http://localhost:3000/browse", {
      headers: { cookie: "refresh_token=t; pid=p" },
    });

    middleware(request);

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.msg).toBe("request");
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/browse");
    expect(typeof parsed.level).toBe("number");
    spy.mockRestore();
  });

  it("emits one JSON-parseable log line for a cookie-less request, which takes the unauthenticated redirect branch", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new NextRequest("http://localhost:3000/");

    middleware(request);

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.msg).toBe("request");
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/");
    expect(typeof parsed.level).toBe("number");
    spy.mockRestore();
  });
});

describe("middleware — AC8/AC10 correlationId forward (S9/S10)", () => {
  it("forwards the caller-supplied correlationId to the request header and the log line, without leaking session cookies into the log", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new NextRequest("http://localhost:3000/browse", {
      headers: {
        cookie: "refresh_token=t; pid=p",
        "x-correlation-id": "t11-probe-0001",
      },
    });

    const response = middleware(request);

    expect(response.headers.get("x-middleware-request-x-correlation-id")).toBe(
      "t11-probe-0001",
    );
    const line = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.correlationId).toBe("t11-probe-0001");
    expect(line).not.toContain("refresh_token=t");
    expect(line).not.toContain("pid=p");
    spy.mockRestore();
  });

  it("generates a UUID v4 correlationId when the caller omits the header", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const request = new NextRequest("http://localhost:3000/browse", {
      headers: { cookie: "refresh_token=t; pid=p" },
    });

    const response = middleware(request);

    expect(
      response.headers.get("x-middleware-request-x-correlation-id"),
    ).toMatch(UUID_V4_REGEX);
    const line = spy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(line);
    expect(parsed.correlationId).toMatch(UUID_V4_REGEX);
    spy.mockRestore();
  });
});
