import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const USER = { email: "test@example.com", name: "Test User" };

describe("visibility command", () => {
  const t = setupCLITests();

  it("fails when no level argument is provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("visibility");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("missing required argument");
  });

  it("fails with an invalid level", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("visibility", "invalid");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("public");
    t.expectResult(result).toContain("private");
    t.expectResult(result).toContain("workspace");
  });

  it("sets visibility on the server from a linked project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    let body: unknown;
    t.api.mockRoute("PUT", `/api/apps/${t.api.appId}`, (req, res) => {
      body = req.body;
      res.status(200).json({});
    });

    const result = await t.run("visibility", "private");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("private");
    expect(body).toEqual({ public_settings: "private_with_login" });
  });

  it("works projectless via --app-id", async () => {
    await t.givenLoggedIn(USER);
    let body: unknown;
    t.api.mockRoute("PUT", `/api/apps/${t.api.appId}`, (req, res) => {
      body = req.body;
      res.status(200).json({});
    });

    const result = await t.run(
      "visibility",
      "workspace",
      "--app-id",
      t.api.appId,
    );

    t.expectResult(result).toSucceed();
    expect(body).toEqual({ public_settings: "workspace_with_login" });
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("visibility", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Set the app's visibility");
  });
});
