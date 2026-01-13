import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("create command", () => {
  const { kit } = setupCLITests();

  // Note: The create command is interactive and uses @clack/prompts.
  // It prompts for:
  // 1. Template selection
  // 2. Project name
  // 3. Description (optional)
  // 4. Project path
  //
  // Full integration testing would require:
  // - Mocking @clack/prompts or
  // - Using a PTY to simulate user input
  //
  // For now, we only test basic command availability.

  it("shows help when called with --help", async () => {
    const result = await kit().run("create", "--help");

    kit().expect(result).toSucceed();
    kit().expect(result).toContain("Create a new Base44 project");
  });
});
