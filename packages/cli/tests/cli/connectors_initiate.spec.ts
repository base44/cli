import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const APP_ID = "test-app-id";

describe("connectors initiate command", () => {
  const t = setupCLITests();

  it("--json emits the redirect URL as a pure JSON document", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockConnectorSet({
      redirect_url: "https://oauth.example.com/authorize?x=1",
      connection_id: "conn-1",
      already_authorized: false,
    });

    // When
    const result = await t.run(
      "connectors",
      "initiate",
      "--app-id",
      APP_ID,
      "--integration-type",
      "gmail",
      "--json",
    );

    // Then
    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.integrationType).toBe("gmail");
    expect(parsed.redirectUrl).toBe("https://oauth.example.com/authorize?x=1");
    expect(parsed.connectionId).toBe("conn-1");
  });

  it("initiates a connector and prints the OAuth URL (no project, --app-id)", async () => {
    // Given — logged in, no local project
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockConnectorSet({
      redirect_url: "https://oauth.example.com/authorize?x=1",
      connection_id: "conn-1",
      already_authorized: false,
    });

    // When
    const result = await t.run(
      "connectors",
      "initiate",
      "--app-id",
      APP_ID,
      "--integration-type",
      "gmail",
      "--scopes",
      "https://mail.google.com/",
    );

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("https://oauth.example.com/authorize");
  });

  it("reports when the connector is already authorized", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockConnectorSet({
      redirect_url: null,
      connection_id: null,
      already_authorized: true,
    });

    // When
    const result = await t.run(
      "connectors",
      "initiate",
      "--app-id",
      APP_ID,
      "--integration-type",
      "slack",
    );

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("already authorized");
  });

  it("fails with a clear message on a backend error", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockConnectorSet({
      redirect_url: null,
      connection_id: null,
      already_authorized: false,
      error: "different_user",
      other_user_email: "owner@example.com",
    });

    // When
    const result = await t.run(
      "connectors",
      "initiate",
      "--app-id",
      APP_ID,
      "--integration-type",
      "gmail",
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("different_user");
  });

  it("resolves the app id from BASE44_APP_ID when no flag is given", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.givenEnv({ BASE44_APP_ID: APP_ID });
    t.api.mockConnectorSet({
      redirect_url: "https://oauth.example.com/authorize?x=2",
      connection_id: "conn-2",
      already_authorized: false,
    });

    // When
    const result = await t.run(
      "connectors",
      "initiate",
      "--integration-type",
      "gmail",
    );

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("https://oauth.example.com/authorize");
  });

  it("fails when --integration-type is missing", async () => {
    // Given
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When
    const result = await t.run("connectors", "initiate", "--app-id", APP_ID);

    // Then
    t.expectResult(result).toFail();
  });

  it("fails when no app id is available", async () => {
    // Given — logged in, no project, no flag, no env
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    // When
    const result = await t.run(
      "connectors",
      "initiate",
      "--integration-type",
      "gmail",
    );

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });
});
