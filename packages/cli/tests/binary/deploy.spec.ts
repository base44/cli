/**
 * Binary integration tests for the deploy command.
 *
 * These tests spawn the real `bin/run.js` process against a local
 * Express mock server, verifying the full binary end-to-end.
 *
 * **Prerequisite:** Run `bun run build` before executing these tests.
 * The suite is skipped automatically when the dist is not built.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { fixture, setupBinaryTests } from "./testkit/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distExists = existsSync(
  join(__dirname, "../../dist/cli/index.js"),
);

describe.skipIf(!distExists)("deploy command (binary)", () => {
  const t = setupBinaryTests();

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
    t.api.mockConnectorsList({ integrations: [] });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys entities, functions, and site together", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.api.mockEntitiesPush({ created: ["Task"], updated: [], deleted: [] });
    t.api.mockFunctionsPush({ deployed: ["hello"], deleted: [], errors: null });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockSiteDeploy({ app_url: "https://full-project.base44.app" });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
    t.expectResult(result).toContain("https://full-project.base44.app");
  });

  it("deploys agents successfully", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockFunctionsPush({ deployed: [], deleted: [], errors: null });
    t.api.mockAgentsPush({
      created: ["customer_support", "order_assistant", "data_analyst"],
      updated: [],
      deleted: [],
    });
    t.api.mockConnectorsList({ integrations: [] });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Deployment completed");
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("fails gracefully when API returns an error", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPushError({ status: 500, body: { error: "Server error" } });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toFail();
  });
});
