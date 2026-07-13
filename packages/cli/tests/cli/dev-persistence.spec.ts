import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServiceAuthorizationHeader } from "@/cli/dev/dev-server/auth/tokens.js";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

const DEV_JSON_PATH = ".base44/dev.json";
const META_JSON_PATH = ".base44/data/meta.json";

/** Spawn a short-lived process and wait for it to exit, returning a dead pid. */
async function getDeadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) {
    throw new Error("Failed to spawn process for dead-pid setup");
  }
  await new Promise((resolve) => child.once("exit", resolve));
  return pid;
}

describe("dev persistence", () => {
  const t = setupCLITests();

  const createProduct = async (devServerUrl: string, title: string) => {
    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/entities/Product`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-App-Id": t.api.appId,
        },
        body: JSON.stringify({ title, price: 10 }),
      },
    );
    expect(response.status).toBe(201);
    return (await response.json()) as Record<string, unknown>;
  };

  const listProducts = async (devServerUrl: string) => {
    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/entities/Product`,
      { headers: { "X-App-Id": t.api.appId } },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>[];
  };

  it("persists entity data across dev server restarts", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const first = await t.runLive("dev");
    const firstUrl = await waitForDevServer(first);
    await createProduct(firstUrl, "Widget");
    await first.stop();

    expect(await t.fileExists(".base44/data/product.db")).toBe(true);

    const second = await t.runLive("dev");
    const secondUrl = await waitForDevServer(second);
    const products = await listProducts(secondUrl);
    await second.stop();

    expect(products).toHaveLength(1);
    expect(products[0].title).toBe("Widget");
  });

  it("does not duplicate the CLI bootstrap user across restarts", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const first = await t.runLive("dev");
    await waitForDevServer(first);
    await first.stop();

    const second = await t.runLive("dev");
    const secondUrl = await waitForDevServer(second);
    const response = await fetch(
      `${secondUrl}/api/apps/${t.api.appId}/entities/User`,
      {
        headers: {
          Authorization: createServiceAuthorizationHeader(),
          "X-App-Id": t.api.appId,
        },
      },
    );
    expect(response.status).toBe(200);
    const users = (await response.json()) as Record<string, unknown>[];
    await second.stop();

    expect(users.filter((u) => u.email === "test@example.com")).toHaveLength(1);
  });

  it("preserves data when entity files change and loads the new schema", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);
    await createProduct(devServerUrl, "Widget");

    await writeFile(
      join(t.getTempDir(), "project", "base44", "entities", "note.json"),
      JSON.stringify({
        name: "Note",
        type: "object",
        properties: { text: { type: "string" } },
      }),
    );
    await handle.waitForOutput(/schemas reloaded \(data preserved\)/, 10000);

    const products = await listProducts(devServerUrl);
    expect(products).toHaveLength(1);
    expect(products[0].title).toBe("Widget");

    const noteResponse = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/entities/Note`,
      { headers: { "X-App-Id": t.api.appId } },
    );
    expect(noteResponse.status).toBe(200);
    await expect(noteResponse.json()).resolves.toEqual([]);

    await handle.stop();
  });

  it("--fresh wipes local data before starting", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const first = await t.runLive("dev");
    const firstUrl = await waitForDevServer(first);
    await createProduct(firstUrl, "Widget");
    await first.stop();

    const second = await t.runLive("dev", "--fresh");
    const secondUrl = await waitForDevServer(second);
    const products = await listProducts(secondUrl);
    await second.stop();

    expect(products).toEqual([]);
  });

  it("writes dev.json while running and removes it on shutdown", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const handle = await t.runLive("dev");
    const devServerUrl = await waitForDevServer(handle);

    const raw = await t.readProjectFile(DEV_JSON_PATH);
    expect(raw).not.toBeNull();
    const devJson = JSON.parse(raw as string) as Record<string, unknown>;
    expect(devJson.appId).toBe(t.api.appId);
    expect(devJson.url).toBe(devServerUrl);
    expect(devJson.port).toBe(Number(new URL(devServerUrl).port));
    expect(devJson.pid).toEqual(expect.any(Number));
    expect(devJson.adminToken).toMatch(/^[0-9a-f]{64}$/);
    expect(devJson.startedAt).toEqual(expect.any(String));
    expect(devJson.dataDir).toContain(".base44");
    expect(devJson.seed).toBeNull();

    await handle.stop();

    expect(await t.fileExists(DEV_JSON_PATH)).toBe(false);
  });

  it("writes meta.json bound to the linked app", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const handle = await t.runLive("dev");
    await waitForDevServer(handle);
    await handle.stop();

    const raw = await t.readProjectFile(META_JSON_PATH);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      formatVersion: 1,
      appId: t.api.appId,
      seed: null,
    });
  });

  it("refuses to start when local data belongs to another app unless --fresh", async () => {
    await t.givenLoggedInWithProject(fixture("with-entities"));

    const first = await t.runLive("dev");
    await waitForDevServer(first);
    await first.stop();

    const metaPath = join(t.getTempDir(), "project", META_JSON_PATH);
    await writeFile(
      metaPath,
      JSON.stringify({ formatVersion: 1, appId: "other-app", seed: null }),
    );

    const blocked = await t.runLive("dev");
    const result = await blocked.waitForExit(15000);
    expect(result.exitCode).not.toBe(0);
    t.expectResult(result).toContain('belongs to app "other-app"');
    t.expectResult(result).toContain("--fresh");

    const fresh = await t.runLive("dev", "--fresh");
    const freshUrl = await waitForDevServer(fresh);
    const products = await listProducts(freshUrl);
    await fresh.stop();

    expect(products).toEqual([]);
    const meta = JSON.parse(
      (await t.readProjectFile(META_JSON_PATH)) as string,
    ) as Record<string, unknown>;
    expect(meta.appId).toBe(t.api.appId);
  });

  describe("dev status", () => {
    it("reports a running server in --json mode without the admin token", async () => {
      await t.givenLoggedInWithProject(fixture("with-entities"));

      const handle = await t.runLive("dev");
      const devServerUrl = await waitForDevServer(handle);

      const result = await t.run("dev", "status", "--json");
      t.expectResult(result).toSucceed();
      const status = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(status.running).toBe(true);
      expect(status.appId).toBe(t.api.appId);
      expect(status.url).toBe(devServerUrl);
      expect(status.port).toBe(Number(new URL(devServerUrl).port));
      expect(status.startedAt).toEqual(expect.any(String));
      expect(status.dataDir).toEqual(expect.any(String));
      expect(status.seed).toBeNull();
      expect(status).not.toHaveProperty("adminToken");
      expect(status).not.toHaveProperty("pid");

      await handle.stop();
    });

    it("prints a human summary for a running server", async () => {
      await t.givenLoggedInWithProject(fixture("with-entities"));

      const handle = await t.runLive("dev");
      const devServerUrl = await waitForDevServer(handle);

      const result = await t.run("dev", "status");
      t.expectResult(result).toSucceed();
      t.expectResult(result).toContain("Dev server is running at");
      t.expectResult(result).toContain(devServerUrl);
      t.expectResult(result).toContain(t.api.appId);

      await handle.stop();
    });

    it("reports not running when no dev server is up", async () => {
      await t.givenLoggedInWithProject(fixture("with-entities"));

      const result = await t.run("dev", "status", "--json");
      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({ running: false });

      const human = await t.run("dev", "status");
      t.expectResult(human).toSucceed();
      t.expectResult(human).toContain("No dev server is running");
    });

    it("treats a dev.json left by a dead process as stale and deletes it", async () => {
      await t.givenLoggedInWithProject(fixture("with-entities"));

      const devJsonPath = join(t.getTempDir(), "project", DEV_JSON_PATH);
      await mkdir(join(t.getTempDir(), "project", ".base44"), {
        recursive: true,
      });
      await writeFile(
        devJsonPath,
        JSON.stringify({
          appId: t.api.appId,
          url: "http://localhost:4400",
          port: 4400,
          pid: await getDeadPid(),
          dataDir: join(t.getTempDir(), "project", ".base44", "data"),
          adminToken: "a".repeat(64),
          startedAt: new Date().toISOString(),
          seed: null,
        }),
      );

      const result = await t.run("dev", "status", "--json");
      t.expectResult(result).toSucceed();
      expect(JSON.parse(result.stdout)).toEqual({ running: false });
      expect(await t.fileExists(DEV_JSON_PATH)).toBe(false);
    });
  });
});
