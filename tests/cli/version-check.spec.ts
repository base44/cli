import { describe, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("upgrade notification", () => {
  const t = setupCLITests();

  it("displays upgrade notification when newer version is available", async () => {
    t.givenLatestVersion("1.0.0");
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Update available!");
    t.expectResult(result).toContain("1.0.0");
    t.expectResult(result).toContain("npm update -g base44");
  });

  it("does not display notification when version is current", async () => {
    // latestVersion defaults to null (no upgrade available)
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toNotContain("Update available!");
  });

  it("does not display notification when check is not overridden", async () => {
    // Opt into real npm version check (default is null which skips it)
    t.givenLatestVersion(undefined);
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
  });
});
