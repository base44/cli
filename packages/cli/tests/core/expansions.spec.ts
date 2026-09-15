import { describe, expect, it } from "vitest";
import { expandPrompt } from "@/cli/commands/imported/expansions.js";

describe("expandPrompt", () => {
  it("expands /headless into the skill block, dropping the token", () => {
    const { text, applied } = expandPrompt(
      "online store selling tmnt action figures /headless",
    );
    expect(applied).toEqual(["headless"]);
    expect(text).toContain("online store selling tmnt action figures");
    expect(text).toContain(
      "https://www.wix.com/skills/headless-fast/entry/skill.md",
    );
    // The token must be gone — but the skill URL legitimately contains the
    // substring "/headless" (headless-fast), so match the bare token only.
    expect(text).not.toMatch(/\/headless(?![\w-])/);
    // The expansion must stay WAF-safe: no shell syntax in the request body.
    expect(text).not.toContain("curl");
  });

  it("leaves unknown tokens and plain prompts untouched", () => {
    expect(expandPrompt("fix the /api route").text).toBe("fix the /api route");
    expect(expandPrompt("no tokens here").applied).toEqual([]);
  });

  it("is idempotent", () => {
    const once = expandPrompt("build a store /headless").text;
    expect(expandPrompt(once).text).toBe(once);
  });
});
