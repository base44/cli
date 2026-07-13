import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("whoami command", () => {
  const t = setupCLITests();

  it("--json wraps the human output in a JSON envelope (generic fallback)", async () => {
    // whoami has no native JSON output; --json should still yield valid JSON.
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.output).toContain("test@example.com");
  });

  it("displays user email when logged in", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logged in as:");
    t.expectResult(result).toContain("test@example.com");
  });

  it("displays different user email correctly", async () => {
    await t.givenLoggedIn({
      email: "another-user@company.org",
      name: "Another User",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("another-user@company.org");
  });
});
