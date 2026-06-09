import { sign } from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const APP_ID = "test-app-id";

/** Build a signed JWT with the given claims (seeding decodes, never verifies). */
function makeJwt(claims: Record<string, unknown>): string {
  return sign(claims, "test-secret");
}

describe("env credential seeding", () => {
  const t = setupCLITests();

  const futureExp = () => Math.floor(Date.now() / 1000) + 3600;

  it("seeds a standard auth.json from env credentials", async () => {
    // No givenLoggedIn(): the only credentials are env vars. The ensureAuth
    // middleware should decode them and write a standard auth file.
    const exp = futureExp();
    const jwt = makeJwt({ sub: "alice@example.com", exp });
    t.givenEnv({
      BASE44_ACCESS_TOKEN: jwt,
      BASE44_REFRESH_TOKEN: "refresh-xyz",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();

    const auth = await t.readAuthFile();
    expect(auth).toMatchObject({
      accessToken: jwt,
      refreshToken: "refresh-xyz",
      email: "alice@example.com",
      name: "alice@example.com",
      expiresAt: exp * 1000,
    });
  });

  it("shows the seeded identity in whoami", async () => {
    t.givenEnv({
      BASE44_ACCESS_TOKEN: makeJwt({
        sub: "alice@example.com",
        exp: futureExp(),
      }),
      BASE44_REFRESH_TOKEN: "refresh-xyz",
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("alice@example.com");
  });

  it("uses the seeded token as the bearer for API calls", async () => {
    await t.givenProject(fixture("with-entities"));
    const jwt = makeJwt({ sub: "alice@example.com", exp: futureExp() });
    t.givenEnv({
      BASE44_ACCESS_TOKEN: jwt,
      BASE44_REFRESH_TOKEN: "refresh-xyz",
    });

    let authHeader: string | undefined;
    t.api.mockRoute("PUT", `/api/apps/${APP_ID}/entity-schemas`, (req, res) => {
      authHeader = req.headers.authorization;
      res.status(200).json({ created: ["customer"], updated: [], deleted: [] });
    });

    const result = await t.run("entities", "push");

    t.expectResult(result).toSucceed();
    expect(authHeader).toBe(`Bearer ${jwt}`);
  });

  it("does not overwrite a stored login when env credentials are incomplete", async () => {
    await t.givenLoggedIn({ email: "real@example.com", name: "Real User" });
    // Access token present but no refresh token → can't form a standard record,
    // so seeding is skipped and the existing login is left untouched.
    t.givenEnv({
      BASE44_ACCESS_TOKEN: makeJwt({
        sub: "alice@example.com",
        exp: futureExp(),
      }),
    });

    const result = await t.run("whoami");

    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("real@example.com");
    const auth = await t.readAuthFile();
    expect(auth?.email).toBe("real@example.com");
  });
});
