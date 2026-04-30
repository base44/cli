import { type Base44Client, createClient } from "@base44/sdk";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, type RunLiveHandle, setupCLITests } from "./testkit/index.js";

describe("auth in dev", () => {
  const t = setupCLITests();
  let handle: RunLiveHandle;
  let base44: Base44Client;

  beforeEach(async () => {
    await t.givenLoggedInWithProject(fixture("basic"));

    handle = await t.runLive("dev");
    const serverUrl = await waitForDevServer(handle);

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
});
