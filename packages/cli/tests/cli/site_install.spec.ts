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

  it("installs with the default command when the configured program is not installed", async () => {
    await t.givenLoggedInWithProject(fixture("with-missing-site-tool"));

    const result = await t.run("site", "install");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("its program is not installed");
    expect(await t.readProjectFile("install-marker.txt")).toBe("installed");
  });

  it("installs with the default command when the project has no site block", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("site", "install");

    t.expectResult(result).toContain("using the default site commands");
    t.expectResult(result).toNotContain("No site install command found");
  });

  it("installs even when a resource file is invalid", async () => {
    // Installing reads only the config, so an entity the CLI would reject at
    // deploy must not block it.
    await t.givenLoggedInWithProject(fixture("with-site-and-invalid-entity"));

    const result = await t.run("site", "install");

    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("install-marker.txt")).toBe("installed");
  });
});
