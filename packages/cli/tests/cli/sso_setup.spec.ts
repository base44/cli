import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("sso setup command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("sso", "setup");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("sso", "setup", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Configure SSO identity provider");
  });

  it("shows sso subcommands with --help on parent", async () => {
    const result = await t.run("sso", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("setup");
    t.expectResult(result).toContain("Manage SSO identity provider");
  });
});
