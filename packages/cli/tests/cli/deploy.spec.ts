import { join } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const DEPLOYMENT_ID = "test-app-git-0f1e2d3c4b5a";
const SESSION_ID = "3f9a1c07b8e44d2f";

/** A real commit, since the unified deploy has no --git-hash to stand in for one. */
async function commitTheProject(projectDir: string): Promise<string> {
  const git = (...args: string[]) => execa("git", args, { cwd: projectDir });
  await git("init");
  await git("config", "user.email", "test@example.com");
  await git("config", "user.name", "Test User");
  await git("add", "-A");
  await git("commit", "-m", "build");
  return (await git("rev-parse", "HEAD")).stdout.trim();
}

describe("deploy command (unified)", () => {
  const t = setupCLITests();

  it("applies app visibility from config during deploy", async () => {
    await t.givenLoggedInWithProject(fixture("with-visibility"));

    let body: unknown;
    t.api.mockRoute("PUT", `/api/apps/${t.api.appId}`, (req, res) => {
      body = req.body;
      res.status(200).json({});
    });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Visibility: private");
    t.expectResult(result).toContain("App visibility set to private");
    expect(body).toEqual({ public_settings: "private_with_login" });
  });

  it("confirms visibility was applied even when a later step fails", async () => {
    // Visibility is set before other resources and is not rolled back, so the
    // "done" confirmation must survive a subsequent failure — otherwise the user
    // can't tell the app's visibility already changed on the server.
    await t.givenLoggedInWithProject(fixture("with-visibility-and-entities"));

    t.api.mockRoute("PUT", `/api/apps/${t.api.appId}`, (_req, res) => {
      res.status(200).json({});
    });
    t.api.mockEntitiesPushError({ status: 500, body: { error: "boom" } });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("App visibility set to private");
  });

  it("fails when --yes is not provided in non-interactive mode", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));
    t.api.mockEntitiesPush({ created: ["Task"], updated: [], deleted: [] });

    const result = await t.run("deploy");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--yes is required in non-interactive mode",
    );
  });

  // The deployments lane belongs to `site deploy`. This command ships the site
  // through the legacy tar.gz step, so it has no commit to address and none of
  // the lane's flags.
  it("does not take the deployments-lane flags", async () => {
    await t.givenLoggedInWithProject(fixture("with-site"));

    const gitHash = await t.run("deploy", "-y", "--git-hash", "a1b2c3d4e5f6");
    const concurrency = await t.run("deploy", "-y", "--concurrency", "5");
    const help = await t.run("deploy", "--help");

    t.expectResult(gitHash).toFail();
    t.expectResult(gitHash).toContain("unknown option");
    t.expectResult(concurrency).toFail();
    t.expectResult(concurrency).toContain("unknown option");
    t.expectResult(help).toNotContain("--git-hash");
    t.expectResult(help).toNotContain("--concurrency");
  });

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
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("still requires a project directory when --app-id is provided", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("deploy", "-y", "--app-id", t.api.appId);

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Project root not found");
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
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
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
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("deploy", "--yes");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys entities and functions together", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    t.api.mockEntitiesPush({ created: ["Order"], updated: [], deleted: [] });
    t.api.mockSingleFunctionDeploy({ status: "deployed" });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys zero-config functions (path-based names) with unified deploy", async () => {
    await t.givenLoggedInWithProject(fixture("with-zero-config-functions"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockSingleFunctionDeploy({ status: "deployed" });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys entities, functions, and site together", async () => {
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.api.mockEntitiesPush({ created: ["Task"], updated: [], deleted: [] });
    t.api.mockSingleFunctionDeploy({ status: "deployed" });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockSiteDeploy({ app_url: "https://full-project.base44.app" });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
    t.expectResult(result).toContain("https://full-project.base44.app");
  });

  it("ships the site through the deployments API and publishes it when the lane is on", async () => {
    // The unified deploy has always made the site live, so on the lane it
    // publishes — the transport is all that changes, and with it the tar.gz
    // upload's size cap.
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.givenEnv({ BASE44_DEPLOYMENTS_API: "1" });
    const gitHash = await commitTheProject(join(t.getTempDir(), "project"));
    t.api.mockEntitiesPush({ created: ["Task"], updated: [], deleted: [] });
    t.api.mockSingleFunctionDeploy({ status: "deployed" });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockDeploymentCreate({
      deployment_id: DEPLOYMENT_ID,
      session_id: SESSION_ID,
      asset_uploads: null,
    });
    t.api.mockDeploymentFinalize({
      deployment_id: DEPLOYMENT_ID,
      app_url: "https://full-project.base44.app",
    });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("https://full-project.base44.app");
    expect(t.api.deploymentCreateRequests).toHaveLength(1);
    expect(
      (t.api.deploymentCreateRequests[0] as { git_hash: string }).git_hash,
    ).toBe(gitHash);
    expect(t.api.finalizeQueries[0]).toEqual({
      session_id: SESSION_ID,
      publish: "true",
    });
  });

  it("asks for a commit rather than falling back to the tar.gz upload", async () => {
    // A deployment is addressed by the commit that produced it, so a build with
    // no address could never be published — and a silent fallback would hide
    // that the deploy took the other transport.
    await t.givenLoggedInWithProject(fixture("full-project"));
    t.givenEnv({ BASE44_DEPLOYMENTS_API: "1" });
    t.api.mockEntitiesPush({ created: ["Task"], updated: [], deleted: [] });
    t.api.mockSingleFunctionDeploy({ status: "deployed" });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("no git commit was found");
    expect(t.api.deploymentCreateRequests).toHaveLength(0);
  });

  it("deploys agents successfully with -y flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockAgentsPush({
      created: ["customer_support", "order_assistant", "data_analyst"],
      updated: [],
      deleted: [],
    });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys agents and entities together", async () => {
    await t.givenLoggedInWithProject(fixture("with-agents"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockAgentsPush({
      created: ["customer_support"],
      updated: ["order_assistant"],
      deleted: [],
    });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
  });

  it("deploys connectors successfully with -y flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSet({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("3 connectors");
  });

  it("shows OAuth info when connectors need authorization with -y flag", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSet({
      redirect_url: "https://accounts.google.com/oauth",
      connection_id: "conn_123",
      already_authorized: false,
    });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("require authorization");
    t.expectResult(result).toContain("base44 connectors push");
  });

  it("shows Stripe provisioned output when Stripe connector is deployed", async () => {
    await t.givenLoggedInWithProject(fixture("with-stripe-connector"));
    t.api.mockEntitiesPush({ created: [], updated: [], deleted: [] });
    t.api.mockFunctionsPush({ deployed: [], deleted: [], errors: null });
    t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSet({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });
    t.api.mockStripeInstall({
      already_installed: false,
      claim_url: "https://connect.stripe.com/setup/claim/xxx",
    });

    const result = await t.run("deploy", "-y");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("App deployed successfully");
    t.expectResult(result).toContain("2 connectors");
    t.expectResult(result).toContain("Stripe sandbox provisioned");
    t.expectResult(result).toContain("connect.stripe.com/setup/claim/xxx");
    t.expectResult(result).toContain("Connectors dashboard");
  });
});
