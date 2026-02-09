import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("connectors pull command", () => {
  const t = setupCLITests();

  it("reports no connectors when remote has none", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockConnectorsList({ integrations: [] });

    const result = await t.run("connectors", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No connectors found on Base44");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("connectors", "pull");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("pulls connectors successfully", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockConnectorsList({
      integrations: [
        {
          integration_type: "gmail",
          status: "active",
          scopes: ["https://mail.google.com/"],
          user_email: "test@example.com",
        },
        {
          integration_type: "slack",
          status: "active",
          scopes: ["chat:write"],
        },
      ],
    });

    const result = await t.run("connectors", "pull");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Connectors fetched successfully");
    t.expectResult(result).toContain("Connector files written successfully");
    t.expectResult(result).toContain("Pulled 2 connectors");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockConnectorsListError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("connectors", "pull");

    t.expectResult(result).toFail();
  });
});
