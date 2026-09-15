import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const GIT_STATUS = {
  current_branch: "base44/setup",
  default_branch: "main",
  head: "4c7e1f90ab3d5628e1a0f7b24c9d8e6350a1b2c4",
  dirty: true,
  dirty_files: ["api/config.py"],
  ahead: 3,
  behind: 0,
  sync_mode: "synced",
  merge_in_progress: false,
};

describe("imported", () => {
  const t = setupCLITests();

  it("status renders the sandbox checkout's git state", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute(
      "GET",
      "/api/apps/test-app-id/imported/git/status",
      (_req, res) => res.json(GIT_STATUS),
    );
    const result = await t.run(
      "imported",
      "status",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toMatchObject({
      current_branch: "base44/setup",
      dirty: true,
      ahead: 3,
    });
  });

  it("commit posts the message and reports the pushed state", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    let sentBody: unknown;
    t.api.mockRoute(
      "POST",
      "/api/apps/test-app-id/imported/git/commit",
      (req, res) => {
        sentBody = req.body;
        return res.json({ ...GIT_STATUS, dirty: false, dirty_files: [] });
      },
    );
    const result = await t.run(
      "imported",
      "commit",
      "-m",
      "tweak config",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBody).toEqual({ message: "tweak config" });
    expect(JSON.parse(result.stdout)).toMatchObject({ dirty: false });
  });

  it("pr requires a title before calling the API", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    const result = await t.run(
      "imported",
      "pr",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain("--title");
  });

  it("pr opens a pull request and prints its URL", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute(
      "POST",
      "/api/apps/test-app-id/imported/git/pull-request",
      (_req, res) =>
        res.json({
          html_url: "https://github.com/acme/app/pull/7",
          number: 7,
          created: true,
        }),
    );
    const result = await t.run(
      "imported",
      "pr",
      "--title",
      "Recipe manager v1",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      url: "https://github.com/acme/app/pull/7",
      number: 7,
      created: true,
    });
  });

  it("chat scopes to the sole active branch and surfaces the reply", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.json([
        { id: "b1", branch_name: "base44/setup-abc", status: "active" },
      ]),
    );
    let sentBranchId: unknown;
    t.api.mockRoute(
      "POST",
      "/api/apps/test-app-id/chat/message",
      (req, res) => {
        sentBranchId = req.query.branch_id;
        return res.json({
          id: "test-app-id",
          status: { state: "ready" },
          conversation: {
            id: "conv-1",
            messages: [
              { role: "user", content: "add login" },
              { role: "assistant", content: "Added session-based login." },
            ],
          },
        });
      },
    );
    const result = await t.run(
      "imported",
      "chat",
      "add login",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBranchId).toBe("b1");
    expect(JSON.parse(result.stdout)).toEqual({
      status: "ready",
      error_source: null,
      reply: "Added session-based login.",
    });
  });

  it("chat reports a queued turn instead of inventing a reply", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.json([]),
    );
    t.api.mockRoute("POST", "/api/apps/test-app-id/chat/message", (_req, res) =>
      res.json({ queued: true }),
    );
    const result = await t.run(
      "imported",
      "chat",
      "one more thing",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({ queued: true });
  });

  it("create <name> is blank mode: one name for repo, app, and directory", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/apps", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({
        id: "new-app-2",
        name: "recipe-box-4",
        imported_repo_url: "https://github.com/tester/recipe-box-4",
      });
    });
    const result = await t.run("imported", "create", "recipe-box-4", "--json");
    t.expectResult(result).toSucceed();
    expect(sentBody).toMatchObject({
      app_type: "imported_app",
      imported_source_mode: "blank",
      imported_new_repo_name: "recipe-box-4",
      name: "recipe-box-4",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ id: "new-app-2" });

    const badName = await t.run("imported", "create", "no/slashes", "--json");
    t.expectResult(badName).toFail();
  });

  it("create --blank requires a repo name and sends the blank payload", async () => {
    await t.givenLoggedIn({ email: "test@example.com", name: "Test User" });

    const missingName = await t.run("imported", "create", "--blank", "--json");
    t.expectResult(missingName).toFail();
    expect(JSON.parse(missingName.stdout).error).toContain("--repo-name");

    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/apps", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({
        id: "new-app-1",
        name: "recipe-box",
        imported_repo_url: "https://github.com/tester/recipe-box",
      });
    });
    const result = await t.run(
      "imported",
      "create",
      "--blank",
      "--repo-name",
      "recipe-box",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBody).toMatchObject({
      app_type: "imported_app",
      imported_source_mode: "blank",
      imported_new_repo_name: "recipe-box",
      name: "recipe-box",
    });
    expect(sentBody).not.toHaveProperty("imported_repo_url");
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: "new-app-1",
      repo_url: "https://github.com/tester/recipe-box",
      status: "created",
    });
  });
});
