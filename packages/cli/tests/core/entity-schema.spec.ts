import { describe, expect, it } from "vitest";
import { EntitySchema } from "@/core/resources/entity/schema.js";

describe("Entity name validation", () => {
  it("accepts alphanumeric names", () => {
    const result = EntitySchema.safeParse({ name: "Customer" });

    expect(result.success).toBe(true);
  });

  it("accepts snake_case names", () => {
    const result = EntitySchema.safeParse({ name: "line_items" });

    expect(result.success).toBe(true);
  });

  it("accepts names with a leading underscore", () => {
    const result = EntitySchema.safeParse({ name: "_internal" });

    expect(result.success).toBe(true);
  });

  it("rejects names with dashes", () => {
    const result = EntitySchema.safeParse({ name: "line-items" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      "Entity name can only contain letters, numbers, and underscores",
    );
  });

  it("rejects names with spaces", () => {
    const result = EntitySchema.safeParse({ name: "line items" });

    expect(result.success).toBe(false);
  });

  it("rejects names with dots", () => {
    const result = EntitySchema.safeParse({ name: "line.items" });

    expect(result.success).toBe(false);
  });

  it("rejects empty names", () => {
    const result = EntitySchema.safeParse({ name: "" });

    expect(result.success).toBe(false);
  });
});
