import { describe, expect, it } from "vitest";
import { checkRLS } from "@/cli/dev/dev-server/db/rls.js";
import { Validator } from "@/cli/dev/dev-server/db/validator.js";
import type { Entity } from "@/core/resources/entity/schema.js";

/**
 * `base44 dev` interprets locally what the server interprets in production, so it
 * has to accept the same entity shapes the schema now allows — otherwise a file
 * that publishes fine behaves differently against the local server.
 */
describe("dev server RLS open-rule values", () => {
  const record = { id: "1", data: {} };

  it("treats every open-rule value as no restriction, even anonymously", () => {
    for (const rule of [undefined, null, "", true, {}] as const) {
      expect(
        checkRLS(rule, record, undefined),
        `rule ${JSON.stringify(rule)}`,
      ).toBe(true);
    }
  });

  it("still denies a real condition when there is no user", () => {
    expect(
      checkRLS({ created_by: "someone@example.com" }, record, undefined),
    ).toBe(false);
  });

  it("still honours an explicit false", () => {
    expect(checkRLS(false, record, undefined)).toBe(false);
  });
});

describe("dev server validation of union field types", () => {
  const entity = (type: unknown): Entity =>
    ({
      name: "ReceiptScan",
      type: "object",
      properties: { price: { type } },
      source: { type: "project" },
    }) as unknown as Entity;

  const validate = (type: unknown, value: unknown) =>
    new Validator().validate({ price: value }, entity(type), true);

  it("accepts either member of a nullable union", () => {
    expect(() => validate(["string", "null"], "4.20")).not.toThrow();
    expect(() => validate(["string", "null"], null)).not.toThrow();
  });

  it("rejects a value matching no member, naming both", () => {
    expect(() => validate(["string", "null"], 42)).toThrow(/string or null/);
  });

  it("still validates a plain single type", () => {
    expect(() => validate("string", "ok")).not.toThrow();
    expect(() => validate("string", 42)).toThrow();
  });
});
