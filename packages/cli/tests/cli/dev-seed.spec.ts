import { type Base44Client, createClient } from "@base44/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, type RunLiveHandle, setupCLITests } from "./testkit/index.js";
import { asUser, entities } from "./testkit/sdk.js";

const CLI_USER = { email: "owner@example.com", name: "Owner" };

describe("dev seeding", () => {
  const t = setupCLITests();
  let handle: RunLiveHandle;
  let base44: Base44Client;

  beforeEach(async () => {
    await t.givenLoggedInWithProject(fixture("with-seed"), CLI_USER);
    handle = await t.runLive("dev");
    const serverUrl = await waitForDevServer(handle);
    base44 = createClient({ appId: t.kit.api.appId, serverUrl });
    // Log in as the auto-seeded CLI admin to read data.
    await base44.auth.loginViaEmailPassword(CLI_USER.email, "x");
  });

  afterEach(async () => {
    await handle.stop();
  });

  it("seeds custom-entity records from base44/seed/<Entity>.json", async () => {
    const rows = await entities(base44).Customer.list();
    const companies = rows.map((r) => r.company as string).sort();
    expect(companies).toEqual(["Acme Inc", "Globex"]);
  });

  it("seeds extra users with roles, alongside the CLI admin", async () => {
    const users = await entities(base44).User.list();
    const byEmail = Object.fromEntries(
      users.map((u) => [u.email as string, u]),
    );

    // CLI admin is still there and still admin.
    expect(asUser(byEmail[CLI_USER.email]).role).toBe("admin");
    // Seeded users came in with their declared roles.
    expect(asUser(byEmail["member@example.com"]).role).toBe("user");
    expect(asUser(byEmail["boss@example.com"]).role).toBe("admin");
  });

  it("lets a seeded admin user log in (so RLS / role-gating is testable)", async () => {
    // Seeded users have no password set; only admins bypass the password
    // check, so a seeded *admin* is the agent-friendly way to assume a role.
    const boss = createClient({
      appId: t.kit.api.appId,
      serverUrl: await waitForDevServer(handle),
    });
    const { access_token } = await boss.auth.loginViaEmailPassword(
      "boss@example.com",
      "anything",
    );
    expect(access_token).toBeTruthy();
    const me = asUser(await boss.auth.me());
    expect(me.email).toBe("boss@example.com");
    expect(me.role).toBe("admin");
  });
});
