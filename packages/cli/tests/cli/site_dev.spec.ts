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
    // The point of the command: the caller's backend, not one started here.
    expect(output).not.toContain("Backend running on");
  });

  it("binds the address it is given", async () => {
    await t.givenLoggedInWithProject(fixture("with-npm-serve-command"));

    const handle = await t.runLive(
      "site",
      "dev",
      "--backend-url",
      "https://preview.example/api",
      "--host",
      "0.0.0.0",
      "--port",
      "5173",
    );
    await handle.waitForOutput(/ARGS=/);
    await handle.stop();

    expect(handle.stdout.join("")).toContain("ARGS=--host 0.0.0.0 --port 5173");
  });

  it("warns when the serveCommand cannot take the address", async () => {
    // A bare binary would read `--` as its own argument, so the address is
    // dropped — loudly, since the caller asked for a reachable server.
    await t.givenLoggedInWithProject(fixture("with-serve-command"));

    const handle = await t.runLive(
      "site",
      "dev",
      "--backend-url",
      "https://preview.example/api",
      "--host",
      "0.0.0.0",
    );
    await handle.waitForOutput(/SERVE_APP=/);
    const result = await handle.stop();

    t.expectResult(result).toContain("were not passed to it");
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
