import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("logout command", () => {
  const t = setupCLITests();

  it("logs out successfully when logged in", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("logout");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logged out successfully");

    // Auth file is removed
    const authData = await t.readAuthFile();
    expect(authData).toBeNull();
  });

  it("succeeds even when not logged in", async () => {
    // No auth file (user not logged in)
    const result = await t.run("logout");

    // Command still succeeds (idempotent operation)
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logged out successfully");
  });
});
