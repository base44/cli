import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("whoami command", () => {
  const { kit } = setupCLITests();

  it("displays user email when logged in", async () => {
    // Given: user is logged in
    await kit().givenLoggedIn({
      email: "test@example.com",
      name: "Test User",
    });

    // When: run whoami command
    const result = await kit().run("whoami");

    // Then: command succeeds and shows user email
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Logged in as:");
    kit().expect(result).toContain("test@example.com");
  });

  it("displays different user email correctly", async () => {
    // Given: a different user is logged in
    await kit().givenLoggedIn({
      email: "another-user@company.org",
      name: "Another User",
    });

    // When: run whoami command
    const result = await kit().run("whoami");

    // Then: shows correct email
    kit().expect(result).toSucceed();
    kit().expect(result).toContain("another-user@company.org");
  });
});
