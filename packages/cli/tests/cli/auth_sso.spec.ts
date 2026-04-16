import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("auth sso command", () => {
  const t = setupCLITests();

  it("fails when no action argument is provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "sso");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("missing required argument");
  });

  it("fails with invalid action", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "sso", "invalid");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("enable");
    t.expectResult(result).toContain("disable");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "x",
      "--client-secret",
      "y",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });

  it("fails enable without --provider", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--client-id",
      "x",
      "--client-secret",
      "y",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Missing --provider");
  });

  it("fails enable without --client-id", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-secret",
      "y",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Missing --client-id");
  });

  it("fails microsoft enable without --tenant-id", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "microsoft",
      "--client-id",
      "abc",
      "--client-secret",
      "xyz",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--tenant-id");
  });

  it("fails okta enable without --okta-domain", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "okta",
      "--client-id",
      "abc",
      "--client-secret",
      "xyz",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--okta-domain");
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("auth", "sso", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO identity provider");
    t.expectResult(result).toContain("--provider");
    t.expectResult(result).toContain("--client-id");
    t.expectResult(result).toContain("--client-secret");
    t.expectResult(result).toContain("--file");
  });

  it("shows sso in auth subcommands", async () => {
    const result = await t.run("auth", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("sso");
  });

  it("enables google SSO with valid flags", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "google-client-id",
      "--client-secret",
      "google-client-secret",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO configured with google");
  });

  it("disables SSO", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsDelete({ success: true });

    const result = await t.run("auth", "sso", "disable");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO disabled");
  });
});
