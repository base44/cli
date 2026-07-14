import { type Base44Client, createClient } from "@base44/sdk";
import { describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, type RunLiveHandle, setupCLITests } from "./testkit/index.js";

// Characterizes the EXACT local-dev auth failures the user reported:
// "with no token the app renders empty/limited ... we just hit 'Unauthorized'
//  or 'App not found' errors" and "the SDK's login path does not seem to work".
// This is the pre-fix reproduction — it asserts the broken behavior is real.
const CLI_USER = { email: "owner@example.com", name: "Owner" };

describe("REPRO: user's auth.me() problem in base44 dev", () => {
  const t = setupCLITests();

  async function startDev(): Promise<{
    handle: RunLiveHandle;
    serverUrl: string;
    base44: Base44Client;
  }> {
    await t.givenLoggedInWithProject(fixture("with-entities"), CLI_USER);
    const handle = await t.runLive("dev");
    const serverUrl = await waitForDevServer(handle);
    const base44 = createClient({ appId: t.kit.api.appId, serverUrl });
    return { handle, serverUrl, base44 };
  }

  it("auth.me() with NO token -> 401 Unauthorized (app renders empty)", async () => {
    const { handle, serverUrl, base44 } = await startDev();
    try {
      // Raw HTTP: exactly what the SDK's auth.me() hits.
      const raw = await fetch(`${serverUrl}/api/apps/${t.kit.api.appId}/entities/User/me`);
      console.log(`[REPRO] GET /entities/User/me (no token) -> HTTP ${raw.status}`);
      expect(raw.status).toBe(401);
      expect(await raw.json()).toEqual({ error: "Unauthorized" });

      // Through the SDK, the same call rejects (this is what gates the page).
      let sdkStatus: number | undefined;
      try {
        await base44.auth.me();
      } catch (e: any) {
        sdkStatus = e?.response?.status ?? e?.status;
      }
      console.log(`[REPRO] base44.auth.me() (no token) -> rejected, status ${sdkStatus}`);
      expect(sdkStatus).toBe(401);
    } finally {
      await handle.stop();
    }
  });

  it("the SDK login redirect goes to base44.app, not the local env ('App not found')", async () => {
    const { handle, serverUrl } = await startDev();
    try {
      // This is where auth.redirectToLogin() / loginWithProvider() send the
      // browser: ${appBaseUrl}/api/apps/auth/login and /login.
      const authLogin = await fetch(
        `${serverUrl}/api/apps/auth/login?app_id=${t.kit.api.appId}`,
        { redirect: "manual" },
      );
      console.log(
        `[REPRO] GET /api/apps/auth/login -> HTTP ${authLogin.status}, Location: ${authLogin.headers.get("location")}`,
      );
      expect([301, 302, 307, 308]).toContain(authLogin.status);
      // Redirected AWAY from the local server to production base44.app, which
      // has no local app/user -> the "App not found" the user sees.
      expect(authLogin.headers.get("location") ?? "").toContain("base44.app");
    } finally {
      await handle.stop();
    }
  });

  it("a token for a user NOT in the local DB -> auth.me() 404 (other facet)", async () => {
    const { handle, serverUrl } = await startDev();
    try {
      // Simulate a token whose subject isn't seeded locally (e.g. a prod OAuth
      // user). The dev server can't resolve them -> 404, not a working session.
      const jwt = (await import("jsonwebtoken")).default;
      const strangerToken = jwt.sign({ sub: "stranger@nowhere.com" }, "LOCAL_DEV_SECRET");
      const raw = await fetch(
        `${serverUrl}/api/apps/${t.kit.api.appId}/entities/User/me`,
        { headers: { Authorization: `Bearer ${strangerToken}` } },
      );
      console.log(`[REPRO] GET /entities/User/me (unknown-user token) -> HTTP ${raw.status}`);
      expect(raw.status).toBe(404);
    } finally {
      await handle.stop();
    }
  });
});
