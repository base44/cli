import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("actors deploy command", () => {
  const t = setupCLITests();

  it("warns when no actors found in project", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("actors", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No actors found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("actors", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("deploys actors successfully", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    t.api.mockSingleActorDeploy({ status: "deployed" });

    const result = await t.run("actors", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deploying ChatRoom");
    t.expectResult(result).toContain("1 deployed");
  });

  it("reports unchanged actor", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    t.api.mockSingleActorDeploy({ status: "unchanged" });

    const result = await t.run("actors", "deploy");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("unchanged");
    t.expectResult(result).toContain("1 unchanged");
  });

  it("deploys specific actor by name", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    t.api.mockSingleActorDeploy({ status: "deployed" });

    const result = await t.run("actors", "deploy", "ChatRoom");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deploying ChatRoom");
    t.expectResult(result).toContain("1 deployed");
  });

  it("accepts comma-separated actor names", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    t.api.mockSingleActorDeploy({ status: "deployed" });

    const result = await t.run("actors", "deploy", "ChatRoom,");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("1 deployed");
  });

  it("fails when actor name not found in project", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));

    const result = await t.run("actors", "deploy", "nonexistent");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("not found in project");
  });

  it("reports error when API fails for an actor", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    t.api.mockSingleActorDeployError({
      status: 400,
      body: { error: "Invalid actor code" },
    });

    const result = await t.run("actors", "deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("error");
    t.expectResult(result).toContain("1 error");
  });
});
