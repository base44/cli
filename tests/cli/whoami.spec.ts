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
    kit().expect(result).toContain("test@example.com");
  });

  // Note: When not logged in, the CLI triggers a login flow which requires
  // user interaction. This test is skipped because mocking the full login
  // flow is complex and covered by login.spec.ts.
});
