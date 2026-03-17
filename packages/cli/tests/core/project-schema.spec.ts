import { describe, expect, it } from "vitest";
import { ProjectConfigSchema } from "@/core/project/schema.js";

describe("ProjectConfigSchema visibility field", () => {
  it('accepts visibility: "public"', () => {
    const result = ProjectConfigSchema.safeParse({
      name: "My App",
      visibility: "public",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe("public");
    }
  });

  it('accepts visibility: "private"', () => {
    const result = ProjectConfigSchema.safeParse({
      name: "My App",
      visibility: "private",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe("private");
    }
  });

  it("accepts omitted visibility (no-op, field is undefined)", () => {
    const result = ProjectConfigSchema.safeParse({ name: "My App" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBeUndefined();
    }
  });

  it("rejects invalid visibility value with a clear error", () => {
    const result = ProjectConfigSchema.safeParse({
      name: "My App",
      visibility: "restricted",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "";
      expect(message).toMatch(
        /Invalid visibility value|Invalid enum value|public.*private/i,
      );
    }
  });
});
