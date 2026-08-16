import { describe, expect, it } from "vitest";
import { EntitySchema } from "@/core/resources/entity/schema.js";

/** Wrap a fragment in the minimum valid entity so each case tests one thing. */
const entity = (patch: Record<string, unknown>) => ({
  name: "Coupon",
  properties: {},
  ...patch,
});

const parse = (patch: Record<string, unknown>) =>
  EntitySchema.safeParse(entity(patch));

/**
 * Every shape below was taken from a real production entity file that this
 * schema rejected, blocking the app's publish. The server accepts and evaluates
 * all of them.
 */
describe("EntitySchema accepts what the platform accepts", () => {
  it("treats null and empty-string RLS rules as open, like the server", () => {
    expect(parse({ rls: { read: null } }).success).toBe(true);
    expect(parse({ rls: { create: "" } }).success).toBe(true);
    expect(parse({ rls: { read: true, create: false } }).success).toBe(true);
    expect(parse({ rls: { read: {} } }).success).toBe(true);
  });

  it("allows every field operator the engine supports, not just four", () => {
    for (const op of [
      "$eq",
      "$ne",
      "$in",
      "$nin",
      "$gt",
      "$gte",
      "$lt",
      "$lte",
      "$exists",
      "$all",
      "$size",
      "$elemMatch",
    ]) {
      const result = parse({
        rls: { read: { "data.score": { [op]: 1 } } },
      });
      expect(result.success, `${op} should be accepted`).toBe(true);
    }
  });

  it("rejects an operator the engine cannot evaluate", () => {
    // An unsupported operator silently matches nothing at runtime, so it is a
    // genuine defect worth failing on.
    expect(
      parse({ rls: { read: { "data.tags": { $contains: 1 } } } }).success,
    ).toBe(false);
  });

  it("enforces the operator allowlist on built-in fields too", () => {
    // created_by is an allowlisted KEY, so the node-level refine short-circuits
    // on it — the field schema is the only thing checking its value.
    expect(
      parse({ rls: { read: { created_by: { $gte: "x" } } } }).success,
    ).toBe(true);
    expect(
      parse({ rls: { read: { created_by: { $contains: "x" } } } }).success,
    ).toBe(false);
  });

  it("rejects a user_condition the engine can only evaluate as never-match", () => {
    // Exact equality only: an operator or a non-scalar silently matches nothing
    // at runtime, which blocks all access rather than granting it.
    expect(
      parse({ rls: { read: { user_condition: { role: { $in: ["a"] } } } } })
        .success,
    ).toBe(false);
    expect(
      parse({ rls: { read: { user_condition: { role: ["a"] } } } }).success,
    ).toBe(false);
    expect(parse({ rls: { read: { user_condition: {} } } }).success).toBe(
      false,
    );
  });

  it("does not restrict which user attributes a user_condition compares", () => {
    const result = parse({
      rls: {
        read: {
          $or: [
            { user_condition: { role: "admin" } },
            { user_condition: { tenant_id: "acme", is_staff: true } },
          ],
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a JSON Schema union type, including nested under items", () => {
    const result = parse({
      properties: {
        scanned_items: {
          type: "array",
          items: {
            type: "object",
            properties: { price: { type: ["string", "null"] } },
          },
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts an underscored entity name, which the platform allows", () => {
    expect(parse({ name: "Order_Item" }).success).toBe(true);
  });

  it("still rejects a name the platform itself rejects", () => {
    // Dotted names fail the server's name rule (^\w+$) too.
    const result = parse({ name: "commerce.Coupon" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain(
      "letters, numbers, and underscores",
    );
  });
});
