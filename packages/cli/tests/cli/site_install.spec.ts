import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("site install command", () => {
  const t = setupCLITests();

  it("runs the site's configured installCommand", async () => {
    await t.givenLoggedInWithProject(fixture("with-installable-site"));

    const result = await t.run("site", "install");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("install-marker.txt")).toBe("installed");
  });

  it("installs without a login", async () => {
    // A build sandbox that has never logged in must still be able to install.
    await t.givenProject(fixture("with-installable-site"));

    const result = await t.run("site", "install");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("install-marker.txt")).toBe("installed");
  });

  it("fails when the installCommand fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-failing-install"));

    const result = await t.run("site", "install");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Install failed");
  });

  it("fails when the project has no site block", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("site", "install");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No site install command found");
  });
});
