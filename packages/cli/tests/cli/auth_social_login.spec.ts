import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSON5 from "json5";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("auth social-login command", () => {
  const t = setupCLITests();

  it("fails when no arguments are provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("missing required argument");
  });

  it("fails when no action argument is provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login", "google");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("missing required argument");
  });

  it("fails with invalid provider", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login", "github", "enable");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("google");
    t.expectResult(result).toContain("microsoft");
    t.expectResult(result).toContain("facebook");
    t.expectResult(result).toContain("apple");
  });

  it("fails with invalid action", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login", "google", "invalid");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("enable");
    t.expectResult(result).toContain("disable");
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("auth", "social-login", "google", "enable");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 app ID found");
  });

  it("shows help with --help flag", async () => {
    const result = await t.run("auth", "social-login", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("social login providers");
  });

  it("shows social-login in auth subcommands", async () => {
    const result = await t.run("auth", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("social-login");
  });

  it("rejects custom OAuth options for non-google providers", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "auth",
      "social-login",
      "microsoft",
      "enable",
      "--client-id",
      "xxx",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      "only supported for providers with custom OAuth",
    );
  });

  it("rejects custom OAuth options when disabling google", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "auth",
      "social-login",
      "google",
      "disable",
      "--client-id",
      "xxx",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("cannot be used with disable");
  });

  it("shows Google OAuth options in help", async () => {
    const result = await t.run("auth", "social-login", "--help");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("--client-id");
    t.expectResult(result).toContain("--client-secret");
    t.expectResult(result).toContain("--client-secret-stdin");
    t.expectResult(result).toContain("--env-file");
  });

  it("rejects secret without --client-id", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "auth",
      "social-login",
      "google",
      "enable",
      "--client-secret",
      "my-secret",
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--client-id is required");
  });

  // ─── HAPPY-PATH TESTS ──────────────────────────────────────────

  it("enables a social provider and writes auth config", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login", "google", "enable");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Google login enabled");
    t.expectResult(result).toContain("base44 auth push");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.enableGoogleLogin).toBe(true);
    expect(config.googleOAuthMode).toBe("default");
  });

  it("disables a social provider and writes auth config", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login", "microsoft", "disable");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Microsoft login disabled");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.enableMicrosoftLogin).toBe(false);
  });

  it("enables google with custom OAuth and pushes secret", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run(
      "auth",
      "social-login",
      "google",
      "enable",
      "--client-id",
      "my-client-id",
      "--client-secret",
      "my-client-secret",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Google login enabled");
    t.expectResult(result).toContain("custom OAuth");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.enableGoogleLogin).toBe(true);
    expect(config.googleOAuthMode).toBe("custom");
    expect(config.googleOAuthClientId).toBe("my-client-id");
  });

  it("enables google with custom OAuth secret via stdin", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });
    t.givenStdin("stdin-secret-value");

    const result = await t.run(
      "auth",
      "social-login",
      "google",
      "enable",
      "--client-id",
      "my-client-id",
      "--client-secret-stdin",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("custom OAuth");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.googleOAuthMode).toBe("custom");
  });

  it("disabling google resets OAuth mode to default", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login", "google", "disable");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Google login disabled");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.enableGoogleLogin).toBe(false);
    expect(config.googleOAuthMode).toBe("default");
    expect(config.googleOAuthClientId).toBeNull();
  });

  it("warns when disabling leaves no login methods", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("auth", "social-login", "google", "disable");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("no login methods enabled");
  });

  it("enables google with --client-id only and hints about secrets", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run(
      "auth",
      "social-login",
      "google",
      "enable",
      "--client-id",
      "my-client-id",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("custom OAuth");
    t.expectResult(result).toContain("base44 secrets set --env-file");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.googleOAuthMode).toBe("custom");
    expect(config.googleOAuthClientId).toBe("my-client-id");
  });

  it("enables google with custom OAuth secret via --env-file", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const envPath = join(t.getTempDir(), ".env");
    await writeFile(envPath, "google_oauth_client_secret=env-file-secret\n");

    const result = await t.run(
      "auth",
      "social-login",
      "google",
      "enable",
      "--client-id",
      "my-client-id",
      "--env-file",
      envPath,
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("custom OAuth");

    const raw = await t.readProjectFile("base44/auth/config.jsonc");
    expect(raw).not.toBeNull();
    const config = JSON5.parse(raw!);
    expect(config.googleOAuthMode).toBe("custom");
    expect(config.googleOAuthClientId).toBe("my-client-id");
  });

  it("fails when --env-file does not contain the expected key", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const envPath = join(t.getTempDir(), ".env");
    await writeFile(envPath, "SOME_OTHER_KEY=value\n");

    const result = await t.run(
      "auth",
      "social-login",
      "google",
      "enable",
      "--client-id",
      "my-client-id",
      "--env-file",
      envPath,
    );

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("google_oauth_client_secret");
    t.expectResult(result).toContain("not found");
  });
});
