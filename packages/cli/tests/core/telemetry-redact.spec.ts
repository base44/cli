import { describe, expect, it } from "vitest";
import {
  redactApiBody,
  redactCommandArgs,
} from "../../src/cli/telemetry/redact.js";

describe("redactCommandArgs", () => {
  it("masks values of KEY=VALUE args", () => {
    expect(redactCommandArgs(["STRIPE_KEY=sk_live_abc123"])).toEqual([
      "STRIPE_KEY=[REDACTED]",
    ]);
  });

  it("masks only the value when it contains '='", () => {
    expect(redactCommandArgs(["TOKEN=abc=def"])).toEqual(["TOKEN=[REDACTED]"]);
  });

  it("leaves args without '=' untouched", () => {
    expect(redactCommandArgs(["my-function", "./path/to/file"])).toEqual([
      "my-function",
      "./path/to/file",
    ]);
  });

  it("leaves args starting with '=' untouched", () => {
    expect(redactCommandArgs(["=weird"])).toEqual(["=weird"]);
  });

  it("handles empty arg lists", () => {
    expect(redactCommandArgs([])).toEqual([]);
  });
});

describe("redactApiBody", () => {
  it("redacts bodies for secrets endpoints", () => {
    expect(
      redactApiBody("https://app.base44.com/api/apps/123/secrets", {
        MY_SECRET: "value",
      }),
    ).toBe("[REDACTED]");
  });

  it("redacts bodies for secrets endpoints with query params", () => {
    expect(
      redactApiBody(
        "https://app.base44.com/api/apps/123/secrets?secret_name=FOO",
        { deleted: true },
      ),
    ).toBe("[REDACTED]");
  });

  it("keeps bodies for other endpoints", () => {
    const body = { name: "my-entity" };
    expect(
      redactApiBody("https://app.base44.com/api/apps/123/entities", body),
    ).toBe(body);
  });

  it("passes through undefined body and URL", () => {
    expect(redactApiBody(undefined, undefined)).toBeUndefined();
    expect(redactApiBody(undefined, { a: 1 })).toEqual({ a: 1 });
  });
});
