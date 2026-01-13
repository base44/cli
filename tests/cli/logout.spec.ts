import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("logout command", () => {
  const { kit } = setupCLITests();

  it("logs out successfully when logged in", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({
      email: "test@example.com",
      name: "Test User",
    });

    // When: run logout command
    const result = await kit().run("logout");

    // Then: command succeeds with logout message
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Logged out successfully");
  });

  it("succeeds even when not logged in", async () => {
    // Given: no auth file (user not logged in)

    // When: run logout command
    const result = await kit().run("logout");

    // Then: command still succeeds (idempotent operation)
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Logged out successfully");
  });
});
