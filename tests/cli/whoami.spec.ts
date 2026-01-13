import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("whoami command", () => {
  const { kit } = setupCLITests();

  it("displays user info when logged in", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({
      email: "test@example.com",
      name: "Test User",
    });

    // When: run whoami command
    const result = await kit().run("whoami");

    // Then: command succeeds and shows user info
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("test@example.com");
    kit().expect(result).toContain("Test User");
  });

  it("shows error when not logged in", async () => {
    // Given: no auth file (user not logged in)

    // When: run whoami command
    const result = await kit().run("whoami");

    // Then: command fails with auth error
    kit().expect(result).toFail();
    kit().expect(result).toContain("Failed to read authentication");
  });
});
