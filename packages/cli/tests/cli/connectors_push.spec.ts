import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("connectors push command", () => {
  const t = setupCLITests();

  it("shows message when no local connectors found", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No local connectors found");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("finds and lists connectors in project", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSet({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Found 3 connectors to push");
  });

  it("displays synced connectors with checkmark", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSet({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("googlecalendar");
    t.expectResult(result).toContain("slack");
    t.expectResult(result).toContain("notion");
  });

  it("displays removed connectors", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockConnectorsList({
      integrations: [
        { integration_type: "slack", status: "active", scopes: ["chat:write"] },
      ],
    });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorRemove({ status: "removed", integration_type: "slack" });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("slack");
    t.expectResult(result).toContain("Removed:");
  });

  it("displays error when sync fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSetError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("connectors", "push");

    // Errors are handled per-connector, command still succeeds
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("googlecalendar");
  });

  it("shows needs authorization when redirect_url is returned", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSet({
      redirect_url: "https://accounts.google.com/oauth",
      connection_id: "conn_123",
      already_authorized: false,
    });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("needs authorization");
    t.expectResult(result).toContain("Skipped OAuth in non-interactive mode");
  });

  it("shows error for different_user response", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockConnectorsList({ integrations: [] });
    t.api.mockStripeStatus({ stripe_mode: null });
    t.api.mockConnectorSet({
      redirect_url: null,
      connection_id: null,
      already_authorized: false,
      error: "different_user",
      error_message: "Already connected by another user",
      other_user_email: "other@example.com",
    });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Already connected by another user");
  });

  describe("stripe", () => {
    it("shows provisioned output with claim URL on fresh install", async () => {
      await t.givenLoggedInWithProject(fixture("with-stripe-connector"));
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

      const result = await t.run("connectors", "push");

      t.expectResult(result).toSucceed();
      t.expectResult(result).toContain("Found 2 connectors to push");
      t.expectResult(result).toContain("Stripe sandbox provisioned");
      t.expectResult(result).toContain("connect.stripe.com/setup/claim/xxx");
      t.expectResult(result).toContain("Connectors dashboard");
    });

    it("shows synced when Stripe is already installed", async () => {
      await t.givenLoggedInWithProject(fixture("with-stripe-connector"));
      t.api.mockConnectorsList({ integrations: [] });
      t.api.mockStripeStatus({ stripe_mode: "sandbox" });
      t.api.mockConnectorSet({
        redirect_url: null,
        connection_id: null,
        already_authorized: true,
      });

      const result = await t.run("connectors", "push");

      t.expectResult(result).toSucceed();
      t.expectResult(result).toContain("Synced: slack, stripe");
    });

    it("shows removed when Stripe is removed locally", async () => {
      await t.givenLoggedInWithProject(fixture("basic"));
      t.api.mockConnectorsList({ integrations: [] });
      t.api.mockStripeStatus({ stripe_mode: "sandbox" });
      t.api.mockStripeRemove({ success: true });

      const result = await t.run("connectors", "push");

      t.expectResult(result).toSucceed();
      t.expectResult(result).toContain("Removed:");
      t.expectResult(result).toContain("stripe");
    });

    it("shows error when Stripe install fails", async () => {
      await t.givenLoggedInWithProject(fixture("with-stripe-connector"));
      t.api.mockConnectorsList({ integrations: [] });
      t.api.mockStripeStatus({ stripe_mode: null });
      t.api.mockConnectorSet({
        redirect_url: null,
        connection_id: null,
        already_authorized: true,
      });
      t.api.mockStripeInstallError({
        status: 500,
        body: { error: "Stripe install failed" },
      });

      const result = await t.run("connectors", "push");

      t.expectResult(result).toSucceed();
      t.expectResult(result).toContain("Failed: stripe");
    });
  });
});
