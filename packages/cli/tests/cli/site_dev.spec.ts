import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("site dev command", () => {
  const t = setupCLITests();

  it("runs the serveCommand as written, appending nothing", async () => {
    // Where the dev server binds is the command's own business: in a sandbox the
    // vite plugin binds it, so nothing is added to the line.
    await t.givenLoggedInWithProject(fixture("with-npm-serve-command"));

    const handle = await t.runLive("site", "dev");
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    expect(handle.stdout.join("")).toContain("ARGS= APP=");
  });

  it("runs a serveCommand that takes no forwarded arguments", async () => {
    // A bare binary used to be refused because the address could not be
    // appended to it. With nothing appended there is nothing to refuse.
    await t.givenLoggedInWithProject(fixture("with-serve-command"));

    const handle = await t.runLive("site", "dev");
    // Wait on the child's own line: the startup message echoes the command,
    // which also contains "SERVE_APP=".
    await handle.waitForOutput(new RegExp(`SERVE_APP=${t.api.appId}`));
    await handle.stop();

    expect(handle.stdout.join("")).toContain(`SERVE_APP=${t.api.appId}`);
  });

  it("takes no arguments", async () => {
    await t.givenLoggedInWithProject(fixture("with-npm-serve-command"));

    const result = await t.run("site", "dev", "--port", "5999");

    t.expectResult(result).toFail();
  });

  it("serves without a login", async () => {
    // The whole point of the command: a build sandbox that has never logged in.
    await t.givenProject(fixture("with-npm-serve-command"));

    const handle = await t.runLive("site", "dev");
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    expect(handle.stdout.join("")).toContain("ARGS=");
  });

  it("serves the frontend same-origin, with no backend url injected", async () => {
    // A sandbox frontend reaches its backend through the vite plugin's /api
    // proxy, so it must not be pointed anywhere else.
    await t.givenLoggedInWithProject(fixture("with-npm-serve-command"));

    const handle = await t.runLive("site", "dev");
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    const output = handle.stdout.join("");
    expect(output).toContain(`APP=${t.api.appId}`);
    expect(output).toContain("URL=undefined");
  });

  it("fails when the project has no site block", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("site", "dev");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("no 'site' block");
  });
});
