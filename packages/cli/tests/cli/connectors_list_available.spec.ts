import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("connectors list-available command", () => {
  const t = setupCLITests();

  it("lists available integrations", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAvailableIntegrationsList({
      integrations: [
        {
          integration_type: "slack",
          display_name: "Slack",
          description: "Connect to Slack workspaces",
          connection_config_fields: [],
        },
        {
          integration_type: "gmail",
          display_name: "Gmail",
          description: "Access Gmail accounts",
          connection_config_fields: [
            {
              name: "client_id",
              display_name: "Client ID",
              description: "OAuth client ID",
              placeholder: "your-client-id",
              required: true,
              validation_pattern: null,
              validation_error: null,
            },
          ],
        },
      ],
    });

    const result = await t.run("connectors", "list-available");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Slack");
    t.expectResult(result).toContain("integrationType: slack");
    t.expectResult(result).toContain("Gmail");
    t.expectResult(result).toContain("integrationType: gmail");
    t.expectResult(result).toContain("name: client_id");
    t.expectResult(result).toContain("displayName: Client ID");
    t.expectResult(result).toContain("Found 2 available integrations");
  });

  it("handles empty list", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAvailableIntegrationsList({
      integrations: [],
    });

    const result = await t.run("connectors", "list-available");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No available integrations found");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAvailableIntegrationsListError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("connectors", "list-available");

    t.expectResult(result).toFail();
  });

  it("fails when API returns invalid data", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockAvailableIntegrationsList({
      integrations: [{ bad: "data" }],
      // biome-ignore lint/suspicious/noExplicitAny: this is a test
    } as any);

    const result = await t.run("connectors", "list-available");

    t.expectResult(result).toFail();
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("connectors", "list-available");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });
});
