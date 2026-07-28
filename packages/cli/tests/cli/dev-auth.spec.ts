import { type Base44Client, createClient } from "@base44/sdk";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, type RunLiveHandle, setupCLITests } from "./testkit/index.js";

describe("auth in dev", () => {
  const t = setupCLITests();
  let handle: RunLiveHandle;
  let base44: Base44Client;
  let serverUrl: string;

  beforeEach(async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    handle = await t.runLive("dev");
    serverUrl = await waitForDevServer(handle);

    base44 = createClient({
      appId: t.kit.api.appId,
      serverUrl,
    });
  });

  afterEach(async () => {
    const result = await handle.stop();
    t.expectResult(result).toSucceed();
  });

  it("should register with email and password using OTP code", async () => {
    const email = "test@email.com";
    const password = "12345678";

    await expect(async () => {
      await base44.auth.loginViaEmailPassword(email, password);
    }).rejects.toThrow("Request failed with status code 401");

    await base44.auth.register({
      email,
      password,
    });

    const otpRegex =
      /In order to complete registration use this verification code: (\d{6})/;

    await handle.waitForOutput(otpRegex);

    const match = otpRegex.exec(handle.stdout.join("\n"));

    expect(match).toBeDefined();

    const { access_token } = await base44.auth.verifyOtp({
      email,
      otpCode: match![1],
    });

    expect(jwt.decode(access_token)?.sub).toBe(email);

    const { access_token: access_token_login } =
      await base44.auth.loginViaEmailPassword(email, password);

    expect(jwt.decode(access_token_login)?.sub).toBe(email);
  });

  it("creates a local user for a valid token whose subject never registered locally", async () => {
    const email = "oauth-minted@example.com";
    const externalToken = jwt.sign({}, "external-secret", { subject: email });

    const authedClient = createClient({
      appId: t.kit.api.appId,
      serverUrl,
      token: externalToken,
    });

    const me = await authedClient.auth.me();
    expect(me.email).toBe(email);

    const meAgain = await authedClient.auth.me();
    expect(meAgain.id).toBe(me.id);
  });

  it("redirects logout back to a localhost from_url instead of production", async () => {
    const fromUrl = "http://localhost:5173/";
    const response = await fetch(
      `${serverUrl}/api/apps/auth/logout?from_url=${encodeURIComponent(fromUrl)}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(fromUrl);
  });

  it("does not redirect logout to foreign origins", async () => {
    const response = await fetch(
      `${serverUrl}/api/apps/auth/logout?from_url=${encodeURIComponent("https://evil.example.com/")}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(200);
  });
});
