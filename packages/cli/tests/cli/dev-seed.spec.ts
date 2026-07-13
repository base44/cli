import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServiceAuthorizationHeader } from "@/cli/dev/dev-server/auth/tokens.js";
import { waitForDevServer } from "./testkit/dev-utils.js";
import { fixture, setupCLITests } from "./testkit/index.js";

const DEV_JSON_PATH = ".base44/dev.json";
const META_JSON_PATH = ".base44/data/meta.json";

describe("dev seeding", () => {
  const t = setupCLITests();

  const serviceHeaders = () => ({
    Authorization: createServiceAuthorizationHeader(),
    "X-App-Id": t.api.appId,
  });

  const listEntity = async (devServerUrl: string, entityName: string) => {
    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/entities/${entityName}`,
      { headers: serviceHeaders() },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>[];
  };

  const createTask = async (devServerUrl: string, title: string) => {
    const response = await fetch(
      `${devServerUrl}/api/apps/${t.api.appId}/entities/Task`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...serviceHeaders() },
        body: JSON.stringify({ title }),
      },
    );
    expect(response.status).toBe(201);
    return (await response.json()) as Record<string, unknown>;
  };

  const readDevJson = async () => {
    const raw = await t.readProjectFile(DEV_JSON_PATH);
    expect(raw).not.toBeNull();
    return JSON.parse(raw as string) as Record<string, unknown>;
  };

  const projectFile = (...segments: string[]) =>
    join(t.getTempDir(), "project", ...segments);

  const writeSeedFile = async (name: string, records: unknown) => {
    await mkdir(projectFile("base44", "seed"), { recursive: true });
    await writeFile(
      projectFile("base44", "seed", name),
      JSON.stringify(records, null, 2),
    );
  };

  describe("auto-seed on dev startup", () => {
    it("applies users and entity fixtures on first boot", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);

      const tasks = await listEntity(url, "Task");
      expect(tasks).toHaveLength(3);

      const users = await listEntity(url, "User");
      const emails = users.map((u) => u.email);
      expect(emails).toContain("test@example.com"); // CLI login user
      expect(emails).toContain("admin@seed.dev");
      expect(emails).toContain("member@seed.dev");

      // created_by attribution points at the seeded user
      const admin = users.find((u) => u.email === "admin@seed.dev");
      const taskOne = tasks.find((task) => task.id === "task-1");
      expect(taskOne?.title).toBe("First seeded task");
      expect(taskOne?.completed).toBe(true);
      expect(taskOne?.created_by).toBe("admin@seed.dev");
      expect(taskOne?.created_by_id).toBe(admin?.id);
      expect(taskOne?.created_date).toEqual(expect.any(String));

      // kebab-case fixture file resolves to the TeamMember entity
      const teamMembers = await listEntity(url, "TeamMember");
      expect(teamMembers).toHaveLength(1);
      expect(teamMembers[0].id).toBe("tm-1");

      // seed state recorded in dev.json and meta.json
      const devJson = await readDevJson();
      expect(devJson.seed).toMatchObject({
        hash: expect.stringMatching(/^sha256:/),
        appliedAt: expect.any(String),
      });
      const meta = JSON.parse(
        (await t.readProjectFile(META_JSON_PATH)) as string,
      ) as Record<string, unknown>;
      expect(meta.seed).toEqual(devJson.seed);

      await handle.stop();
    });

    it("does not re-apply seeds on a plain restart", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const first = await t.runLive("dev");
      const firstUrl = await waitForDevServer(first);
      await createTask(firstUrl, "Manual task");
      await first.stop();

      const second = await t.runLive("dev");
      const secondUrl = await waitForDevServer(second);
      const tasks = await listEntity(secondUrl, "Task");
      await second.stop();

      // replace-mode re-seed would drop the manual task back to 3
      expect(tasks).toHaveLength(4);
    });

    it("hints when seed files changed since the last apply", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const first = await t.runLive("dev");
      await waitForDevServer(first);
      await first.stop();

      await writeSeedFile("task.jsonc", [
        { id: "task-1", title: "Changed title", created_by: "admin@seed.dev" },
      ]);

      const second = await t.runLive("dev");
      const secondUrl = await waitForDevServer(second);
      await second.waitForOutput(/Seed files changed/);

      // hint only — data stays as-is until `dev seed` is run
      const tasks = await listEntity(secondUrl, "Task");
      expect(tasks).toHaveLength(3);
      await second.stop();
    });

    it("--fresh wipes local data and re-seeds", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const first = await t.runLive("dev");
      const firstUrl = await waitForDevServer(first);
      await createTask(firstUrl, "Manual task");
      await first.stop();

      const fresh = await t.runLive("dev", "--fresh");
      const freshUrl = await waitForDevServer(fresh);
      const tasks = await listEntity(freshUrl, "Task");
      await fresh.stop();

      expect(tasks).toHaveLength(3);
      expect(tasks.map((task) => task.title)).not.toContain("Manual task");
    });
  });

  describe("dev seed command", () => {
    it("applies seeds offline (no dev server) in upsert mode", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const result = await t.run("dev", "seed", "--json");

      t.expectResult(result).toSucceed();
      const summary = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(summary).toMatchObject({
        applied: true,
        mode: "upsert",
        users: 2,
        records: {
          // id-less record is skipped in upsert mode, even on empty data
          Task: { created: 2, updated: 0, skipped: 1 },
          TeamMember: { created: 1, updated: 0, skipped: 0 },
        },
        script: null,
        warnings: [],
      });

      // dev startup then sees seeded (non-empty) data and does not re-seed
      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);
      const tasks = await listEntity(url, "Task");
      await handle.stop();
      expect(tasks).toHaveLength(2);
    });

    it("upserts by id and skips id-less records against a live server", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);

      await writeSeedFile("task.jsonc", [
        {
          id: "task-1",
          title: "First seeded task (edited)",
          completed: true,
          created_by: "admin@seed.dev",
        },
        { id: "task-2", title: "Second seeded task" },
        { title: "Task without a stable id" },
      ]);

      const result = await t.run("dev", "seed", "--json");
      t.expectResult(result).toSucceed();
      const summary = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(summary).toMatchObject({
        applied: true,
        mode: "upsert",
        users: 2,
        records: {
          Task: { created: 0, updated: 2, skipped: 1 },
          TeamMember: { created: 0, updated: 1, skipped: 0 },
        },
      });

      const tasks = await listEntity(url, "Task");
      expect(tasks).toHaveLength(3);
      expect(tasks.find((task) => task.id === "task-1")?.title).toBe(
        "First seeded task (edited)",
      );

      await handle.stop();
    });

    it("--replace truncates seeded collections and keeps the CLI login user", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);
      await createTask(url, "Manual task");

      const result = await t.run(
        "dev",
        "seed",
        "--replace",
        "--force",
        "--json",
      );
      t.expectResult(result).toSucceed();
      const summary = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(summary).toMatchObject({
        mode: "replace",
        records: { Task: { created: 3, updated: 0, skipped: 0 } },
      });

      const tasks = await listEntity(url, "Task");
      expect(tasks).toHaveLength(3);
      expect(tasks.map((task) => task.title)).not.toContain("Manual task");

      const users = await listEntity(url, "User");
      expect(users.map((u) => u.email)).toContain("test@example.com");

      await handle.stop();
    });

    it("requires --force for --replace in non-interactive mode", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const result = await t.run("dev", "seed", "--replace");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("--force");
    });

    it("prints per-entity counts in human mode", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const result = await t.run("dev", "seed");

      t.expectResult(result).toSucceed();
      t.expectResult(result).toContain("Users: 2 seeded");
      t.expectResult(result).toContain("Task: 2 created, 0 updated, 1 skipped");
    });

    it("reports validation errors citing file and index", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      await writeSeedFile("task.jsonc", [
        { id: "task-1", title: "Valid" },
        { id: "task-2", title: "Broken", completed: "yes" },
      ]);

      const result = await t.run("dev", "seed", "--json");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("seed/task.jsonc");
      t.expectResult(result).toContain("at index 1");
    });

    it("fails when created_by references an unknown user", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      await writeSeedFile("task.jsonc", [
        { id: "task-1", title: "Orphan", created_by: "ghost@nowhere.dev" },
      ]);

      const result = await t.run("dev", "seed", "--json");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("created_by references unknown user");
      t.expectResult(result).toContain("ghost@nowhere.dev");
      t.expectResult(result).toContain("at index 0");
    });

    it("warns about fixtures that match no entity without failing", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      await writeSeedFile("ghost.jsonc", [{ id: "g-1", spooky: true }]);

      const result = await t.run("dev", "seed", "--json");

      t.expectResult(result).toSucceed();
      const summary = JSON.parse(result.stdout) as {
        records: Record<string, unknown>;
        warnings: string[];
      };
      expect(summary.warnings.join("\n")).toContain("seed/ghost.jsonc");
      expect(summary.records).not.toHaveProperty("Ghost");
      expect(summary.records).toHaveProperty("Task");
    });
  });

  describe("seeded users", () => {
    it("can log in with the seeded password", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);

      const login = (password: string) =>
        fetch(`${url}/api/apps/${t.api.appId}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "member@seed.dev", password }),
        });

      const ok = await login("seedmember1");
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as Record<string, unknown>;
      expect(body.access_token).toEqual(expect.any(String));

      const bad = await login("wrong-password");
      expect(bad.status).toBe(400);

      await handle.stop();
    });
  });

  describe("admin endpoints", () => {
    it("rejects requests without or with a wrong admin token", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);

      const noToken = await fetch(`${url}/_base44/dev/status`);
      expect(noToken.status).toBe(401);

      const wrongToken = await fetch(`${url}/_base44/dev/status`, {
        headers: { "x-base44-dev-admin": "f".repeat(64) },
      });
      expect(wrongToken.status).toBe(401);

      const seedNoToken = await fetch(`${url}/_base44/dev/seed`, {
        method: "POST",
      });
      expect(seedNoToken.status).toBe(401);

      const resetNoToken = await fetch(`${url}/_base44/dev/reset`, {
        method: "POST",
      });
      expect(resetNoToken.status).toBe(401);

      await handle.stop();
    });

    it("serves status, seed, and reset with the admin token", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);
      const { adminToken } = (await readDevJson()) as { adminToken: string };
      const headers = {
        "x-base44-dev-admin": adminToken,
        "Content-Type": "application/json",
      };

      const statusResponse = await fetch(`${url}/_base44/dev/status`, {
        headers,
      });
      expect(statusResponse.status).toBe(200);
      const status = (await statusResponse.json()) as Record<string, unknown>;
      expect(status.appId).toBe(t.api.appId);
      expect(status.port).toBe(Number(new URL(url).port));
      expect(status.startedAt).toEqual(expect.any(String));
      expect(status.seed).toMatchObject({
        hash: expect.stringMatching(/^sha256:/),
      });
      expect(status.collections).toMatchObject({
        task: 3,
        teammember: 1,
        user: 3,
      });

      const seedResponse = await fetch(`${url}/_base44/dev/seed`, {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "upsert" }),
      });
      expect(seedResponse.status).toBe(200);
      const summary = (await seedResponse.json()) as Record<string, unknown>;
      expect(summary).toMatchObject({ applied: true, mode: "upsert" });

      const resetResponse = await fetch(`${url}/_base44/dev/reset`, {
        method: "POST",
        headers,
      });
      expect(resetResponse.status).toBe(200);
      const reset = (await resetResponse.json()) as Record<string, unknown>;
      expect(reset).toMatchObject({ reset: true, seeded: true });

      await handle.stop();
    });
  });

  describe("dev reset command", () => {
    it("resets and re-seeds against a live server", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const handle = await t.runLive("dev");
      const url = await waitForDevServer(handle);
      await createTask(url, "Manual task");

      const result = await t.run("dev", "reset", "--force", "--json");
      t.expectResult(result).toSucceed();
      const reset = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(reset).toMatchObject({
        reset: true,
        seeded: true,
        dataDir: expect.stringContaining(".base44"),
        seed: {
          mode: "replace",
          records: { Task: { created: 3, updated: 0, skipped: 0 } },
        },
      });

      const tasks = await listEntity(url, "Task");
      expect(tasks).toHaveLength(3);
      expect(tasks.map((task) => task.title)).not.toContain("Manual task");

      // bootstrap CLI login user was re-inserted after the wipe
      const users = await listEntity(url, "User");
      expect(users.map((u) => u.email)).toContain("test@example.com");

      await handle.stop();
    });

    it("resets and re-seeds offline", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const first = await t.runLive("dev");
      const firstUrl = await waitForDevServer(first);
      await createTask(firstUrl, "Manual task");
      await first.stop();

      const result = await t.run("dev", "reset", "--force", "--json");
      t.expectResult(result).toSucceed();
      const reset = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(reset).toMatchObject({ reset: true, seeded: true });

      const second = await t.runLive("dev");
      const secondUrl = await waitForDevServer(second);
      const tasks = await listEntity(secondUrl, "Task");
      await second.stop();

      expect(tasks).toHaveLength(3);
      expect(tasks.map((task) => task.title)).not.toContain("Manual task");
    });

    it("requires --force in non-interactive mode", async () => {
      await t.givenLoggedInWithProject(fixture("with-seed"));

      const result = await t.run("dev", "reset");

      t.expectResult(result).toFail();
      t.expectResult(result).toContain("--force");
    });
  });
});
