import { describe, it, expect } from "vitest";
import { formatApiError } from "../../src/core/clients/index.js";

describe("formatApiError", () => {
  it("returns message when present", () => {
    const error = {
      error_type: "HTTPException",
      message: "Unauthorized access",
      detail: "Token expired",
    };

    expect(formatApiError(error)).toBe("Unauthorized access");
  });

  it("falls back to detail when message is not present", () => {
    const error = { detail: "Some error detail" };

    expect(formatApiError(error)).toBe("Some error detail");
  });

  it("falls back to full object when neither message nor detail present", () => {
    const error = { error_type: "UnknownError" };

    expect(formatApiError(error)).toBe('{\n  "error_type": "UnknownError"\n}');
  });

  it("stringifies message when it is an object", () => {
    const error = {
      message: { field: "name", error: "required" },
      detail: "some detail",
    };

    expect(formatApiError(error)).toBe('{\n  "field": "name",\n  "error": "required"\n}');
  });

  it("stringifies detail when it is an array", () => {
    const error = {
      detail: [{ loc: ["name"], msg: "field required" }],
    };

    expect(formatApiError(error)).toBe(
      '[\n  {\n    "loc": [\n      "name"\n    ],\n    "msg": "field required"\n  }\n]'
    );
  });

  it("handles null input", () => {
    expect(formatApiError(null)).toBe("null");
  });

  it("handles undefined input", () => {
    // JSON.stringify(undefined) returns undefined (not a string)
    // eslint-disable-next-line unicorn/no-useless-undefined
    expect(formatApiError(undefined)).toBeUndefined();
  });

  it("returns string as-is when input is a plain string", () => {
    expect(formatApiError("plain error string")).toBe("plain error string");
  });
});
