import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("site dev command", () => {
  const t = setupCLITests();

  it("serves the frontend against the given backend, with no local backend", async () => {
    await t.givenLoggedInWithProject(fixture("with-npm-serve-command"));

    const handle = await t.runLive(
      "site",
      "dev",
      "--backend-url",
      "https://preview.example/api",
    );
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    const output = handle.stdout.join("");
    expect(output).toContain(`APP=${t.api.appId}`);
    expect(output).toContain("URL=https://preview.example/api");
  });

  it("binds the sandbox convention when nothing names an address", async () => {
    // The point of the defaults: apper runs `base44 site dev` with no arguments
    // and no knowledge of what they would have been.
    await t.givenLoggedInWithProject(fixture("with-npm-serve-command"));

    const handle = await t.runLive("site", "dev");
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    expect(handle.stdout.join("")).toContain("ARGS=--host 0.0.0.0 --port 5173");
  });

  it("binds what the config names, the only way to change it", async () => {
    await t.givenLoggedInWithProject(fixture("with-dev-address"));

    const handle = await t.runLive("site", "dev");
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    expect(handle.stdout.join("")).toContain(
      "ARGS=--host 127.0.0.1 --port 4321",
    );
  });

  it("takes no address flags at all", async () => {
    await t.givenLoggedInWithProject(fixture("with-npm-serve-command"));

    const result = await t.run("site", "dev", "--port", "5999");

    t.expectResult(result).toFail();
  });

  it("refuses an address the serveCommand cannot take", async () => {
    // A bare binary would read `--` as its own argument. Failing is the point:
    // the caller asked for a reachable server, and a warning plus exit 0 would
    // leave a sandbox serving on some other port and reporting success.
    await t.givenLoggedInWithProject(fixture("with-serve-command"));

    const result = await t.run("site", "dev");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("takes no forwarded arguments");
  });

  it("serves without a login", async () => {
    // The whole point of the command: a build sandbox that has never logged in.
    await t.givenProject(fixture("with-npm-serve-command"));

    const handle = await t.runLive("site", "dev");
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    expect(handle.stdout.join("")).toContain("ARGS=");
  });

  it("uses the project's own spelling of the host flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-hostname-serve-command"));

    const handle = await t.runLive("site", "dev");
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    expect(handle.stdout.join("")).toContain(
      "ARGS=--hostname 0.0.0.0 --port 5173",
    );
  });

  it("injects no backend url when the caller names none", async () => {
    // A frontend that reaches its backend same-origin must not be handed one.
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

    const result = await t.run(
      "site",
      "dev",
      "--backend-url",
      "https://preview.example/api",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("no 'site' block");
  });
});
