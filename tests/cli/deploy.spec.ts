import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("deploy command (unified)", () => {
  const t = setupCLITests();

  it("reports no resources when project is empty", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No resources found to deploy");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("deploys entities successfully with -y flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPush({
      created: ["Customer", "Product"],
      updated: [],
      deleted: [],
    });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys entities successfully with --yes flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPush({
      created: ["Customer", "Product"],
      updated: [],
      deleted: [],
    });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });

    const result = await t.run("deploy", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
  });

  it("deploys entities and functions together", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockEntitiesPush({ created: ["Order"], updated: [], deleted: [] });
    t.api.mockFunctionsPush({
      deployed: ["process-order"],
      deleted: [],
      errors: null,
    });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
  });

  it("deploys entities, functions, and site together", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.api.mockEntitiesPush({ created: ["Task"], updated: [], deleted: [] });
    t.api.mockFunctionsPush({ deployed: ["hello"], deleted: [], errors: null });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockSiteDeploy({ app_url: "https://full-project.base44.app" });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
    t.expectResult(result).toContain("https://full-project.base44.app");
  });

  it("deploys agents successfully with -y flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockFunctionsPush({ deployed: [], deleted: [], errors: null });
    t.api.mockAgentsPush({
      created: ["customer_support", "order_assistant", "data_analyst"],
      updated: [],
      deleted: [],
    });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys agents and entities together", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockFunctionsPush({ deployed: [], deleted: [], errors: null });
    t.api.mockAgentsPush({
      created: ["customer_support"],
      updated: ["order_assistant"],
      deleted: [],
    });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
  });
});
