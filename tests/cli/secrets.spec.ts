import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("secrets list command", () => {
  const t = setupCLITests();

  it("lists secret names", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsList({
      DATABASE_URL: "xxxxxxxxxxxxxxxx",
      API_KEY: "xxxxxxxxxxxx",
    });

    const result = await t.run("secrets", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("DATABASE_URL");
    t.expectResult(result).toContain("API_KEY");
    t.expectResult(result).toContain("Found 2 secrets");
  });

  it("shows message when no secrets exist", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsList({});

    const result = await t.run("secrets", "list");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("No secrets configured");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsListError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("secrets", "list");

    t.expectResult(result).toFail();
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("secrets", "list");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });
});

describe("secrets set command", () => {
  const t = setupCLITests();

  it("sets a single secret via KEY=VALUE", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run("secrets", "set", "OPENAI_API_KEY=sk-abc123");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("OPENAI_API_KEY");
    t.expectResult(result).toContain("set successfully");
  });

  it("sets multiple secrets", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run("secrets", "set", "KEY1=value1", "KEY2=value2");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("KEY1");
    t.expectResult(result).toContain("KEY2");
  });

  it("sets secrets from --env-file with absolute path", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const envFilePath = join(t.getTempDir(), ".env.test");
    await writeFile(
      envFilePath,
      "# comment\nDB_HOST=localhost\nDB_PASS=secret123\n",
    );

    const result = await t.run("secrets", "set", "--env-file", envFilePath);

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("DB_HOST");
    t.expectResult(result).toContain("DB_PASS");
  });

  it("sets secrets from --env-file with relative path", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    // Write .env file inside the project dir (which is process.cwd() in tests)
    const projectDir = join(t.getTempDir(), "project");
    await writeFile(join(projectDir, ".env.local"), "SECRET_KEY=mysecret\n");

    const result = await t.run("secrets", "set", "--env-file", ".env.local");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("SECRET_KEY");
  });

  it("errors when neither entries nor --env-file provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("secrets", "set");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--env-file");
  });

  it("errors on bad format (missing =)", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("secrets", "set", "INVALID_FORMAT");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("KEY=VALUE");
  });

  it("handles values containing = signs", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSet({ success: true });

    const result = await t.run(
      "secrets",
      "set",
      "CONNECTION_STRING=postgres://user:pass@host/db?opt=val",
    );

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("CONNECTION_STRING");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsSetError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("secrets", "set", "KEY=value");

    t.expectResult(result).toFail();
  });
});

describe("secrets delete command", () => {
  const t = setupCLITests();

  it("errors when no key provided", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    const result = await t.run("secrets", "delete");

    t.expectResult(result).toFail();
  });

  it("deletes a single secret", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsDelete({ success: true });

    const result = await t.run("secrets", "delete", "API_KEY");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("API_KEY");
    t.expectResult(result).toContain("deleted");
  });

  it("fails when API returns error", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockSecretsDeleteError({
      status: 500,
      body: { error: "Server error" },
    });

    const result = await t.run("secrets", "delete", "KEY");

    t.expectResult(result).toFail();
  });

  it("fails when not in a project directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const result = await t.run("secrets", "delete", "KEY");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("No Base44 project found");
  });
});
