import { BadRequestException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

// Same shape as crypto.randomUUID() output — mirrors Task 2's
// correlation-id.test.ts (S5); test files don't share a module.
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("AllExceptionsFilter fallback (R5-N1)", () => {
  it("generates and echoes a correlation id when req.id is unset (body-parser error path, R3-S4)", () => {
    const filter = new AllExceptionsFilter();
    const req = { id: undefined, headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new BadRequestException("invalid JSON"), host);

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Correlation-Id",
      expect.stringMatching(UUID_V4_REGEX),
    );
    const generatedId = res.setHeader.mock.calls[0]?.[1];
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: generatedId }),
    );
  });

  it("does not regenerate a correlation id when req.id is already set (S2)", () => {
    const filter = new AllExceptionsFilter();
    const req = { id: "preset-1", headers: {} };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new BadRequestException("invalid JSON"), host);

    expect(res.setHeader).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "preset-1" }),
    );
  });
});
