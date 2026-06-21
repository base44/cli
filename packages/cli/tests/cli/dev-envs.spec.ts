import { type Base44Client, createClient } from "@base44/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";
import { asUser, entities } from "./testkit/sdk.js";

const CLI_USER = { email: "owner@example.com", name: "Owner" };

// Track env names so we can tear them down even if an assertion fails.
const started: string[] = [];

describe("dev background envs (docker-style)", () => {
  const t = setupCLITests();

  beforeEach(async () => {
    await t.givenLoggedInWithProject(fixture("with-seed"), CLI_USER);
  });

  afterEach(async () => {
    for (const name of started.splice(0)) {
      await t.run("dev", "stop", name, "--rm");
    }
  });

  it("run -d starts a healthy background env and prints its url", async () => {
    const res = await t.run("dev", "run", "-d", "--name", "alpha", "--json");
    started.push("alpha");
    expect(res.exitCode).toBe(0);
    const env = JSON.parse(res.stdout);
    expect(env.status).toBe("running");
    expect(env.url).toMatch(/^http:\/\/localhost:\d+$/);

    // The url really serves the dev backend: seeded data is readable.
    const base44 = createClient({ appId: t.kit.api.appId, serverUrl: env.url });
    await base44.auth.loginViaEmailPassword(CLI_USER.email, "x");
    const rows = await entities(base44).Customer.list();
    expect(rows.map((r) => r.company as string).sort()).toEqual([
      "Acme Inc",
      "Globex",
    ]);
  });

  it("ps lists running envs and inspect exposes url/port/pid/logPath", async () => {
    await t.run("dev", "run", "-d", "--name", "beta");
    started.push("beta");

    const ps = await t.run("dev", "ps", "--json");
    const envs = JSON.parse(ps.stdout);
    const beta = envs.find((e: { name: string }) => e.name === "beta");
    expect(beta?.status).toBe("running");

    const inspect = await t.run("dev", "inspect", "beta");
    const detail = JSON.parse(inspect.stdout);
    expect(detail.alive).toBe(true);
    expect(detail.port).toBeGreaterThan(0);
    expect(detail.logPath).toContain("beta");
  });

  it("logs surfaces the env's backend output", async () => {
    await t.run("dev", "run", "-d", "--name", "gamma");
    started.push("gamma");
    const logs = await t.run("dev", "logs", "gamma");
    expect(logs.stdout).toContain("Loaded entities");
    expect(logs.stdout).toContain("Seeded");
  });

  it("two envs are isolated: different ports and independent databases", async () => {
    const a = JSON.parse(
      (await t.run("dev", "run", "-d", "--name", "iso-a", "--json")).stdout,
    );
    started.push("iso-a");
    const b = JSON.parse(
      (await t.run("dev", "run", "-d", "--name", "iso-b", "--json")).stdout,
    );
    started.push("iso-b");

    expect(a.port).not.toBe(b.port);

    const clientFor = async (url: string): Promise<Base44Client> => {
      const c = createClient({ appId: t.kit.api.appId, serverUrl: url });
      await c.auth.loginViaEmailPassword(CLI_USER.email, "x");
      return c;
    };
    const ca = await clientFor(a.url);
    const cb = await clientFor(b.url);

    // Write to A only; B must not see it (separate logical databases).
    await entities(ca).Customer.create({ company: "OnlyInA" });
    const aCompanies = (await entities(ca).Customer.list()).map(
      (r) => r.company as string,
    );
    const bCompanies = (await entities(cb).Customer.list()).map(
      (r) => r.company as string,
    );
    expect(aCompanies).toContain("OnlyInA");
    expect(bCompanies).not.toContain("OnlyInA");
  });

  it("token mints an SDK-usable session for a seeded user", async () => {
    await t.run("dev", "run", "-d", "--name", "tok", "--json");
    started.push("tok");
    const env = JSON.parse((await t.run("dev", "inspect", "tok")).stdout);

    const tokenRes = await t.run("dev", "token", "--email", "boss@example.com");
    const token = tokenRes.stdout.trim();
    expect(token.split(".")).toHaveLength(3); // looks like a JWT

    // The SDK accepts the token directly — no browser login needed.
    const base44 = createClient({
      appId: t.kit.api.appId,
      serverUrl: env.url,
      token,
    });
    const me = asUser(await base44.auth.me());
    expect(me.email).toBe("boss@example.com");
    expect(me.role).toBe("admin");
  });

  it("stop --rm tears the env down and removes it from ps", async () => {
    await t.run("dev", "run", "-d", "--name", "doomed");
    await t.run("dev", "stop", "doomed", "--rm");
    const ps = await t.run("dev", "ps", "--json");
    const envs = JSON.parse(ps.stdout);
    expect(
      envs.find((e: { name: string }) => e.name === "doomed"),
    ).toBeUndefined();
  });
});
