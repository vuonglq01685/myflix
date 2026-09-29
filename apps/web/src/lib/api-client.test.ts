import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api-client";

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-correlation-id", "t11-probe-0001"]]),
}));

const respond = (status: number, body?: unknown) =>
  vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

describe("apiFetch — HLD §8.2 error envelope", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns undefined on 204", async () => {
    vi.stubGlobal("fetch", respond(204));
    await expect(
      apiFetch("/my-list/x", { method: "POST" }),
    ).resolves.toBeUndefined();
  });

  it("throws ApiError carrying the server errorCode", async () => {
    vi.stubGlobal(
      "fetch",
      respond(422, {
        statusCode: 422,
        errorCode: "ASSET_NOT_READY",
        message: "processing",
        correlationId: "c1",
        timestamp: "t",
      }),
    );
    await expect(apiFetch("/playback/session")).rejects.toMatchObject({
      body: { errorCode: "ASSET_NOT_READY", correlationId: "c1" },
    });
  });

  it("synthesises an envelope when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gateway down", { status: 502 })),
    );
    const err = await apiFetch("/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).body).toMatchObject({
      statusCode: 502,
      errorCode: "INTERNAL_ERROR",
    });
  });
});

describe("apiFetch — AC8 forwards correlationId during SSR", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("attaches X-Correlation-Id from the request-scoped header store to the outgoing request", async () => {
    const fetchSpy = respond(204);
    vi.stubGlobal("fetch", fetchSpy);

    await apiFetch("/x");

    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Correlation-Id"]).toBe("t11-probe-0001");
  });
});
