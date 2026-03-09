import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("sso remove command", () => {
  const t = setupCLITests();

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("sso", "remove");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("sso", "remove", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Remove SSO identity provider");
  });

  it("shows remove in sso subcommands", async () => {
    const result = await t.run("sso", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("remove");
  });
});
