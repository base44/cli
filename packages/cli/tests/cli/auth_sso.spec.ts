import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSON5 from "json5";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("auth sso command", () => {
  const t = setupCLITests();

  // ─── ARGUMENT VALIDATION ────────────────────────────────────────

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

  // ─── REQUIRED-FIELD VALIDATION ──────────────────────────────────

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

  it("fails microsoft enable without --tenant-id (uses CLI flag in error)", async () => {
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
    // The whole point of buildSSOSecrets's catch — flag names, not API keys
    t.expectResult(result).toContain("--tenant-id");
    t.expectResult(result).toNotContain("sso_tenant_id");
  });

  it("fails custom enable without --sso-name (uses CLI flag in error, not --name)", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "custom",
      "--client-id",
      "abc",
      "--client-secret",
      "xyz",
      "--auth-endpoint",
      "https://idp/authorize",
      "--token-endpoint",
      "https://idp/token",
      "--userinfo-endpoint",
      "https://idp/userinfo",
      "--jwks-uri",
      "https://idp/jwks",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--sso-name");
    // Regression: regex-based conversion would yield --name, which is not a valid flag
    t.expectResult(result).toNotContain("--name,");
    t.expectResult(result).toNotContain("--name ");
  });

  it("fails okta enable without --okta-domain (uses CLI flag in error)", async () => {
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
    t.expectResult(result).toNotContain("sso_okta_domain");
  });

  // ─── HELP / DISCOVERY ───────────────────────────────────────────

  it("shows help with --help flag", async () => {
    const result = await t.run("auth", "sso", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO identity provider");
    t.expectResult(result).toContain("--provider");
    t.expectResult(result).toContain("--client-id");
    t.expectResult(result).toContain("--client-secret");
    t.expectResult(result).toContain("--file");
    t.expectResult(result).toContain("--env-file");
    t.expectResult(result).toContain("--client-secret-stdin");
    // Mutual-exclusivity is documented in the description
    t.expectResult(result).toContain("mutually exclusive");
  });

  it("shows sso in auth subcommands", async () => {
    const result = await t.run("auth", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("sso");
  });

  // ─── HAPPY-PATH TESTS ───────────────────────────────────────────

  it("enables google SSO and writes auth config + pushes secrets", async () => {
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

    // Local config was written
    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.enableSSOLogin).toBe(true);
    expect(config.ssoProviderName).toBe("google");
    // Mutual exclusivity
    expect(config.enableGoogleLogin).toBe(false);
  });

  it("disables SSO", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsDelete({ success: true });

    const result = await t.run("auth", "sso", "disable");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO disabled");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.enableSSOLogin).toBe(false);
    expect(config.ssoProviderName).toBeNull();
  });

  it("rejects enable-only flags when used with disable", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "auth",
      "sso",
      "disable",
      "--provider",
      "google",
      "--client-id",
      "x",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("cannot be used with disable");
  });

  // ─── SECRET INPUT METHODS ───────────────────────────────────────

  it("enables SSO with --client-secret-stdin", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });
    t.givenStdin("stdin-secret-value");

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "google-id",
      "--client-secret-stdin",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO configured with google");
  });

  it("enables SSO with --env-file resolving sso_client_secret", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const envPath = join(t.getTempDir(), ".env.sso");
    await writeFile(envPath, "sso_client_secret=env-file-secret-value\n");

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "google-id",
      "--env-file",
      envPath,
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO configured with google");
  });

  it("fails when --env-file does not contain sso_client_secret", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const envPath = join(t.getTempDir(), ".env.sso");
    await writeFile(envPath, "SOMETHING_ELSE=value\n");

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "google-id",
      "--env-file",
      envPath,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("sso_client_secret");
    t.expectResult(result).toContain("not found");
  });

  // ─── --file INPUT ───────────────────────────────────────────────

  it("enables SSO from a JSON --file", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const filePath = join(t.getTempDir(), "sso.json");
    await writeFile(
      filePath,
      JSON.stringify({
        provider: "okta",
        clientId: "okta-id",
        clientSecret: "okta-secret",
        oktaDomain: "myorg.okta.com",
      }),
    );

    const result = await t.run("auth", "sso", "enable", "--file", filePath);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO configured with okta");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.enableSSOLogin).toBe(true);
    expect(config.ssoProviderName).toBe("okta");
  });

  it("fails on invalid JSON in --file", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const filePath = join(t.getTempDir(), "sso.json");
    await writeFile(filePath, "{not valid json");

    const result = await t.run("auth", "sso", "enable", "--file", filePath);

    t.expectResult(result).toFail();
  });

  it("fails when both --file and --env-file are provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const filePath = join(t.getTempDir(), "sso.json");
    await writeFile(
      filePath,
      JSON.stringify({
        provider: "google",
        clientId: "google-id",
        clientSecret: "google-secret",
      }),
    );
    const envPath = join(t.getTempDir(), ".env.sso");
    await writeFile(envPath, "sso_client_secret=other-secret\n");

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--file",
      filePath,
      "--env-file",
      envPath,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "--file and --env-file cannot be used together",
    );
  });

  it("fails on schema-invalid --file content", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const filePath = join(t.getTempDir(), "sso.json");
    await writeFile(
      filePath,
      JSON.stringify({ provider: "unknown-provider", clientId: "x" }),
    );

    const result = await t.run("auth", "sso", "enable", "--file", filePath);

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Invalid SSO config file");
  });

  // ─── DEFAULTS / OVERRIDES ───────────────────────────────────────

  it("allows --scope and --discovery-url to override provider defaults", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run(
      "auth",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "google-id",
      "--client-secret",
      "google-secret",
      "--scope",
      "openid email",
      "--discovery-url",
      "https://custom.example.com/.well-known/openid-configuration",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SSO configured with google");
  });
});
