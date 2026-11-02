import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

describe("whoami command", () => {
  const t = setupCLITests();

  it("--json wraps the human output in a JSON envelope (generic fallback)", async () => {
    // whoami has no native JSON output; --json should still yield valid JSON.
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockUserInfo({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami", "--json");

    t.expectResult(result).toSucceed();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.output).toContain("test@example.com");
  });

  it("displays user email when logged in", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockUserInfo({ email: "test@example.com", name: "Test User" });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Logged in as:");
    t.expectResult(result).toContain("test@example.com");
  });

  it("displays different user email correctly", async () => {
    await t.givenLoggedIn({
      email: "another-user@company.org",
      name: "Another User",
    });
    t.api.mockUserInfo({
      email: "another-user@company.org",
      name: "Another User",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("another-user@company.org");
  });

  it("refreshes the token and retries when the server rejects it", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockToken({
      access_token: "refreshed-access-token",
      refresh_token: "refreshed-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
    });
    t.api.mockRoute("GET", "/oauth/userinfo", (req, res) => {
      if (req.headers.authorization === "Bearer refreshed-access-token") {
        res.status(200).json({ email: "test@example.com", name: "Test User" });
      } else {
        res.status(401).json({ error: "Unauthorized" });
      }
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("test@example.com");
  });

  it("fails as expired when the server refuses the session", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockError("post", "/oauth/token", {
      status: 400,
      body: { error: "invalid_grant" },
    });
    t.api.mockError("get", "/oauth/userinfo", {
      status: 401,
      body: { error: "Unauthorized" },
    });

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("session has expired");
    t.expectResult(result).toContain("base44 login");
  });

  it("fails as not logged in, without starting a login", async () => {
    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Not logged in");
  });

  it("keeps the login when the server errors", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const authBefore = await t.readAuthFile();
    t.api.mockError("get", "/oauth/userinfo", {
      status: 500,
      body: { error: "Internal Server Error" },
    });

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("verifying the session");
    expect(await t.readAuthFile()).toEqual(authBefore);
  });

  it("keeps the login when the server can't be reached", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const authBefore = await t.readAuthFile();
    t.api.mockRoute("GET", "/oauth/userinfo", (req) => {
      req.socket.destroy();
    });

    const result = await t.run("whoami");

    t.expectResult(result).toFail();
    t.expectResult(result).toContain("verifying the session");
    expect(await t.readAuthFile()).toEqual(authBefore);
  });
});
