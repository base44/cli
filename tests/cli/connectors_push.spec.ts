import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("connectors push command", () => {
  const t = setupCLITests();

  it("shows message when no local connectors found", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockConnectorsList({ integrations: [] });

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
    t.api.mockConnectorRemove({ status: "removed", integration_type: "slack" });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("slack");
    t.expectResult(result).toContain("Removed:");
  });

  it("displays error when sync fails", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockConnectorsList({ integrations: [] });
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
    t.api.mockConnectorSet({
      redirect_url: "https://accounts.google.com/oauth",
      connection_id: "conn_123",
      already_authorized: false,
    });

    const result = await t.run("connectors", "push");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("needs authorization");
    t.expectResult(result).toContain("Skipped OAuth in CI");
  });

  it("shows error for different_user response", async () => {
    await t.givenLoggedInWithProject(fixture("with-connectors"));
    t.api.mockConnectorsList({ integrations: [] });
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
});
