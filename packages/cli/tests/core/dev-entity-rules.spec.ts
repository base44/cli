import { describe, expect, it } from "vitest";
import { checkRLS } from "@/cli/dev/dev-server/db/rls.js";
import { Validator } from "@/cli/dev/dev-server/db/validator.js";
import type { Entity } from "@/core/resources/entity/schema.js";

/**
 * `base44 dev` interprets locally what the platform interprets in production,
 * so it has to accept the same entity shapes the schema now allows — otherwise
 * a file that publishes fine behaves differently against the local server.
 */
describe("dev server RLS open-rule values", () => {
  const record = { id: "1", data: {} };

  it("treats every OPEN_RULE_VALUE as no restriction, even anonymously", () => {
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
    new Validator().validateFieldTypes({ price: value }, entity(type));

  it("accepts either member of a nullable union", () => {
    expect(validate(["string", "null"], "4.20").hasError).toBe(false);
    expect(validate(["string", "null"], null).hasError).toBe(false);
  });

  it("rejects a value matching no member, naming both", () => {
    const result = validate(["string", "null"], 42);

    expect(result.hasError).toBe(true);
    expect(JSON.stringify(result.error)).toContain("string or null");
  });

  it("still validates a plain single type", () => {
    expect(validate("string", "ok").hasError).toBe(false);
    expect(validate("string", 42).hasError).toBe(true);
  });
});
