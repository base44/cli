import { cp, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("actors commands", () => {
  const t = setupCLITests();

  it("keeps function pruning on the platform's filtered function list", async () => {
    await t.givenLoggedInWithProject(fixture("with-functions-and-entities"));
    await cp(
      fixture("with-actors/base44/actors"),
      join(t.getTempDir(), "project/base44/actors"),
      { recursive: true },
    );
    const deployed: string[] = [];
    const deleted: string[] = [];
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/backend-functions/:name`,
      (req, res) => {
        deployed.push(String(req.params.name));
        res.json({ status: "deployed" });
      },
    );
    t.api.mockFunctionsList({
      functions: [
        {
          name: "process-order",
          deployment_id: "function-current",
          entry: "entry.ts",
          files: [],
          automations: [],
        },
        {
          name: "removed",
          deployment_id: "function-removed",
          entry: "entry.ts",
          files: [],
          automations: [],
        },
      ],
    });
    t.api.mockRoute(
      "DELETE",
      `/api/apps/${t.api.appId}/backend-functions/:name`,
      (req, res) => {
        deleted.push(String(req.params.name));
        res.status(204).end();
      },
    );
    const result = await t.run("functions", "deploy", "--force");
    t.expectResult(result).toSucceed();
    expect(deployed).toEqual(["process-order"]);
    expect(deleted).toEqual(["removed"]);
    expect(await t.fileExists("base44/actors/ChatRoom/entry.ts")).toBe(true);
  });

  it("deploys all actors with exact folder-local payloads and preserves warnings", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    const requests: { name: string; body: unknown }[] = [];
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/:name`,
      (req, res) => {
        requests.push({ name: String(req.params.name), body: req.body });
        res.json({
          status: req.params.name === "ChatRoom" ? "deployed" : "unchanged",
          warnings: ["Deployment warning"],
        });
      },
    );

    const result = await t.run("actors", "deploy", "--json");

    t.expectResult(result).toSucceed();
    expect(requests.map(({ name }) => name)).toEqual(["ChatRoom", "Counter"]);
    expect(requests[0].body).toEqual({
      entry: "entry.ts",
      files: await Promise.all(
        ["data.json", "deno.jsonc", "entry.ts", "lib/message.ts"].map(
          async (path) => ({
            path,
            content: await t.readProjectFile(`base44/actors/ChatRoom/${path}`),
          }),
        ),
      ),
    });
    expect(requests[1].body).toEqual({
      entry: "entry.js",
      files: [
        {
          path: "entry.js",
          content: await t.readProjectFile("base44/actors/Counter/entry.js"),
        },
      ],
    });
    expect(JSON.parse(result.stdout)).toEqual({
      actors: [
        {
          name: "ChatRoom",
          status: "deployed",
          warnings: ["Deployment warning"],
          durationMs: expect.any(Number),
        },
        {
          name: "Counter",
          status: "unchanged",
          warnings: ["Deployment warning"],
          durationMs: expect.any(Number),
        },
      ],
      summary: { deployed: 1, unchanged: 1, failed: 0 },
    });
    expect(result.stderr).toContain("Deployment warning");
  });

  it.each([
    "file",
    "directory",
  ])("deploys actor content through a linked %s", async (type) => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    const root = join(t.getTempDir(), "project");
    const actorDir = join(root, "base44/actors/ChatRoom");
    const files = await Promise.all(
      ["data.json", "deno.jsonc", "entry.ts", "lib/message.ts"].map(
        async (path) => ({
          path,
          content: await t.readProjectFile(`base44/actors/ChatRoom/${path}`),
        }),
      ),
    );
    const source =
      type === "file" ? join(actorDir, "lib/message.ts") : actorDir;
    const target = join(
      root,
      type === "file" ? "shared-message.ts" : "shared-actor",
    );
    await rename(source, target);
    await symlink(target, source, type === "file" ? "file" : "dir");
    let payload: unknown;
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/ChatRoom`,
      (req, res) => {
        payload = req.body;
        res.json({ status: "deployed" });
      },
    );

    const result = await t.run("actors", "deploy", "ChatRoom", "--json");

    t.expectResult(result).toSucceed();
    expect(payload).toEqual({ entry: "entry.ts", files });
  });

  it("selects and deduplicates names supplied with spaces and commas", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    const names: string[] = [];
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/:name`,
      (req, res) => {
        names.push(String(req.params.name));
        res.json({ status: "deployed" });
      },
    );
    const result = await t.run(
      "actors",
      "deploy",
      "Counter,Counter",
      "Counter",
    );
    t.expectResult(result).toSucceed();
    expect(names).toEqual(["Counter"]);
  });

  it.each([
    "Missing",
    "bad-name",
    "class",
    "../ChatRoom",
  ])("validates every requested name before deployment: %s", async (name) => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    let writes = 0;
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/:name`,
      (_req, res) => {
        writes++;
        res.json({ status: "deployed" });
      },
    );
    const result = await t.run("actors", "deploy", "ChatRoom", name, "--json");
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain(name);
    expect(writes).toBe(0);
  });

  it.each([
    {
      status: 400,
      body: { detail: "Invalid actor source" },
      message: "Invalid actor source",
    },
    {
      status: 403,
      body: { detail: "Publishing denied" },
      message: "Publishing denied",
    },
    {
      status: 200,
      body: { status: "unknown" },
      message: "Invalid actor deployment response",
    },
  ])("continues after a failed actor and returns all outcomes ($status)", async ({
    status,
    body,
    message,
  }) => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    const names: string[] = [];
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/:name`,
      (req, res) => {
        names.push(String(req.params.name));
        if (req.params.name === "ChatRoom")
          res.set("x-request-id", "actor-request").status(status).json(body);
        else res.json({ status: "deployed" });
      },
    );
    const result = await t.run("actors", "deploy", "--json");
    t.expectResult(result).toFail();
    expect(names).toEqual(["ChatRoom", "Counter"]);
    const error = JSON.parse(result.stdout);
    expect(error.code).toBe("RESOURCE_DEPLOYMENT_FAILED");
    expect(error.details.join("\n")).toContain(message);
    expect(error.details.join("\n")).toContain("Counter: deployed");
    if (status !== 200) {
      expect(error.details.join("\n")).toContain(`HTTP ${status}`);
      expect(error.details.join("\n")).toContain("actor-request");
    }
  });

  it("uses actorsDir relative to config.jsonc and respects --app-id", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const root = t.getTempDir();
    await cp(fixture("with-actors"), root, { recursive: true });
    await rename(join(root, "base44/actors"), join(root, "rooms"));
    await writeFile(
      join(root, "base44/config.jsonc"),
      JSON.stringify({ name: "Custom actors", actorsDir: "../rooms" }),
    );
    const names: string[] = [];
    t.api.mockRoute("PUT", "/api/apps/overridden/actors/:name", (req, res) => {
      names.push(String(req.params.name));
      res.json({ status: "deployed" });
    });
    const result = await t.run(
      "actors",
      "deploy",
      "ChatRoom",
      "--app-id",
      "overridden",
    );
    t.expectResult(result).toSucceed();
    expect(names).toEqual(["ChatRoom"]);
  });

  it("fails without a checkout even with --app-id", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const result = await t.run("actors", "deploy", "--app-id", t.api.appId);
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("Project root not found");
  });

  it("returns an empty successful result when no actors exist", async () => {
    await t.givenLoggedInWithProject(fixture("basic"));
    const result = await t.run("actors", "deploy", "--json");
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      actors: [],
      summary: { deployed: 0, unchanged: 0, failed: 0 },
    });
  });

  it.each([
    "local",
    "plugin",
  ])("rejects a collision with a %s backend function before deployment", async (source) => {
    await t.givenLoggedInWithProject(
      fixture(source === "plugin" ? "with-config-plugins" : "with-actors"),
    );
    const root = join(t.getTempDir(), "project");
    const name = source === "plugin" ? "crm__syncCustomer" : "ChatRoom";
    if (source === "plugin") {
      await cp(
        fixture("with-actors/base44/actors/ChatRoom"),
        join(root, "base44/actors", name),
        { recursive: true },
      );
    } else {
      await mkdir(join(root, "base44/functions", name), { recursive: true });
      await cp(
        fixture("full-project/base44/functions/hello/entry.ts"),
        join(root, "base44/functions", name, "entry.ts"),
      );
    }
    let writes = 0;
    t.api.mockRoute(
      "PUT",
      `/api/apps/${t.api.appId}/actors/:name`,
      (_req, res) => {
        writes++;
        res.json({ status: "deployed" });
      },
    );
    const result = await t.run("actors", "deploy");
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("both a backend function and an actor");
    expect(writes).toBe(0);
  });

  it("does not load or validate plugin actors", async () => {
    await t.givenLoggedInWithProject(fixture("with-config-plugins"));
    await cp(
      fixture("actor-validation"),
      join(t.getTempDir(), "project/plugins/crm/base44/actors"),
      { recursive: true },
    );
    const result = await t.run("actors", "deploy", "--json");
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout).actors).toEqual([]);
  });

  it("deletes remote actors without a checkout and treats 404 as already absent", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const names: string[] = [];
    t.api.mockRoute(
      "DELETE",
      `/api/apps/${t.api.appId}/actors/:name`,
      (req, res) => {
        names.push(String(req.params.name));
        if (req.params.name === "Missing")
          res.status(404).json({ detail: "Not found" });
        else res.json({ status: "deleted", handler_name: req.params.name });
      },
    );
    const result = await t.run(
      "actors",
      "delete",
      "ChatRoom,Missing",
      "ChatRoom",
      "--app-id",
      t.api.appId,
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(names).toEqual(["ChatRoom", "Missing"]);
    expect(JSON.parse(result.stdout)).toEqual({
      actors: [
        { name: "ChatRoom", status: "deleted" },
        { name: "Missing", status: "not_found" },
      ],
      summary: { deleted: 1, notFound: 1, failed: 0 },
    });
  });

  it("preserves local source files after deletion", async () => {
    await t.givenLoggedInWithProject(fixture("with-actors"));
    const before = await t.readProjectFile("base44/actors/ChatRoom/entry.ts");
    t.api.mockRoute(
      "DELETE",
      `/api/apps/${t.api.appId}/actors/ChatRoom`,
      (_req, res) => res.json({ status: "deleted", handler_name: "ChatRoom" }),
    );
    const result = await t.run("actors", "delete", "ChatRoom");
    t.expectResult(result).toSucceed();
    expect(await t.readProjectFile("base44/actors/ChatRoom/entry.ts")).toBe(
      before,
    );
  });

  it.each([
    { names: [] },
    { names: ["ChatRoom", "bad-name"] },
    { names: [","] },
  ])("validates delete arguments before mutation: $names", async ({
    names,
  }) => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    let writes = 0;
    t.api.mockRoute(
      "DELETE",
      `/api/apps/${t.api.appId}/actors/:name`,
      (_req, res) => {
        writes++;
        res.json({});
      },
    );
    const result = await t.run(
      "actors",
      "delete",
      ...names,
      "--app-id",
      t.api.appId,
      "--json",
    );
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toBeTruthy();
    expect(writes).toBe(0);
  });

  it.each([
    403, 200,
  ])("continues delete after an HTTP or schema error (%s)", async (status) => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const names: string[] = [];
    t.api.mockRoute(
      "DELETE",
      `/api/apps/${t.api.appId}/actors/:name`,
      (req, res) => {
        names.push(String(req.params.name));
        if (req.params.name === "ChatRoom")
          res.status(status).json({ detail: "Publishing denied" });
        else res.json({ status: "deleted", handler_name: req.params.name });
      },
    );
    const result = await t.run(
      "actors",
      "delete",
      "ChatRoom",
      "Counter",
      "--app-id",
      t.api.appId,
      "--json",
    );
    t.expectResult(result).toFail();
    expect(names).toEqual(["ChatRoom", "Counter"]);
    expect(JSON.parse(result.stdout).details.join("\n")).toContain(
      "Counter: deleted",
    );
  });
});
