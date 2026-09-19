import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupCLITests } from "./testkit/index.js";

const USER = { email: "test@example.com", name: "Test User" };

describe("builder", () => {
  const t = setupCLITests();

  it("new <prompt> creates a template app, waits for the settled turn, returns the preview", async () => {
    await t.givenLoggedIn(USER);
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/apps", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({ id: "app-1", name: "invoice-tracker" });
    });
    // A template app works on main: no branches to scope to.
    t.api.mockRoute("GET", "/api/apps/app-1/branches", (_req, res) =>
      res.json([]),
    );
    // The turn's user message already carries a terminal outcome → settles on
    // the first poll.
    t.api.mockRoute(
      "GET",
      "/api/apps/app-1/chat/full-conversation",
      (_req, res) =>
        res.json({
          messages: [
            {
              id: "u1",
              role: "user",
              content: "invoice tracker",
              outcome: { backend_status: "success_build" },
            },
          ],
        }),
    );
    t.api.mockRoute("GET", "/api/apps/app-1", (_req, res) =>
      res.json({ id: "app-1", status: { state: "ready" } }),
    );
    t.api.mockRoute("GET", "/api/apps/app-1/sandbox/preview-url", (_req, res) =>
      res.json({ preview_url: "preview-app-1.base44.app" }),
    );

    const result = await t.run("builder", "new", "invoice tracker", "--json");
    t.expectResult(result).toSucceed();
    expect(sentBody).toMatchObject({
      initial_message: { content: "invoice tracker" },
    });
    // No app_type and no repo fields: the backend defaults to a user_app.
    expect(sentBody).not.toHaveProperty("app_type");
    expect(sentBody).not.toHaveProperty("imported_source_mode");
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: "app-1",
      status: "ready",
      preview_url: "https://preview-app-1.base44.app",
      dir: expect.stringMatching(/^[a-z0-9-]+$/),
      path: expect.stringMatching(/[\\/][a-z0-9-]+$/), // absolute, either separator
      repo_url: null,
    });
  });

  it("new --import <repo> builds over an existing repository", async () => {
    await t.givenLoggedIn(USER);
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/apps", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({
        id: "imp-1",
        name: "my-store",
        imported_repo_url: "https://github.com/me/my-store",
      });
    });
    const result = await t.run(
      "builder",
      "new",
      "--import",
      "https://github.com/me/my-store",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBody).toMatchObject({
      app_type: "imported_app",
      imported_source_mode: "direct",
      imported_repo_url: "https://github.com/me/my-store",
      name: "my-store",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: "imp-1",
      repo_url: "https://github.com/me/my-store",
      status: "created",
      dir: expect.stringMatching(/^[a-z0-9-]+$/),
    });
  });

  it("new in an empty directory links that directory and names the app after it", async () => {
    await t.givenLoggedIn(USER);
    // An empty cwd is the project itself — the `base44 create` rule.
    await t.givenProject(await mkdtemp(join(tmpdir(), "b44-empty-")));
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/apps", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({ id: "app-here" });
    });
    const result = await t.run(
      "builder",
      "new",
      "--import",
      "https://github.com/me/my-store",
      "--json",
    );
    t.expectResult(result).toSucceed();
    // The folder names the app, ahead of the repo's own name.
    expect(sentBody).toMatchObject({ name: "project" });
    const out = JSON.parse(result.stdout);
    expect(out.dir).toBe(".");
    expect(out.path.replace(/\\/g, "/")).toMatch(/\/project$/);
    expect(existsSync(join(out.path, "base44"))).toBe(true);
  });

  it("new --path links the given directory instead of ./<name>", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("POST", "/api/apps", (_req, res) =>
      res.json({ id: "app-path" }),
    );
    const result = await t.run(
      "builder",
      "new",
      "--import",
      "https://github.com/me/my-store",
      "--path",
      "apps/shop",
      "--json",
    );
    t.expectResult(result).toSucceed();
    const out = JSON.parse(result.stdout);
    expect(out.dir.replace(/\\/g, "/")).toBe("apps/shop");
    expect(out.path.replace(/\\/g, "/")).toMatch(/\/apps\/shop$/);
    expect(existsSync(join(out.path, "base44"))).toBe(true);
  });

  it("new --wix-instance creates through the Wix route with the prompt argument", async () => {
    await t.givenLoggedIn(USER);
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/wix/create-app", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({ app_id: "wix-1", client_creation_id: "initial-abc" });
    });
    t.api.mockRoute("GET", "/api/apps/wix-1/branches", (_req, res) =>
      res.json([]),
    );
    t.api.mockRoute(
      "GET",
      "/api/apps/wix-1/chat/full-conversation",
      (_req, res) =>
        res.json({
          messages: [
            {
              id: "u1",
              role: "user",
              content: "x",
              outcome: { backend_status: "success_build" },
            },
          ],
        }),
    );
    t.api.mockRoute("GET", "/api/apps/wix-1", (_req, res) =>
      res.json({ id: "wix-1", status: { state: "ready" } }),
    );
    t.api.mockRoute("GET", "/api/apps/wix-1/sandbox/preview-url", (_req, res) =>
      res.json({ preview_url: "preview-wix-1.base44.app" }),
    );
    const result = await t.run(
      "builder",
      "new",
      "add online booking",
      "--wix-instance",
      "SIGNED.INSTANCE",
      "--wix-client-id",
      "client-9",
      "--name",
      "spa",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBody).toEqual({
      prompt: "add online booking",
      signed_instance: "SIGNED.INSTANCE",
      wix_client_id: "client-9",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: "wix-1",
      client_creation_id: "initial-abc",
      status: "ready",
      preview_url: "https://preview-wix-1.base44.app",
    });
  });

  it("new --wix-instance needs a prompt, and --wix-client-id needs --wix-instance", async () => {
    await t.givenLoggedIn(USER);
    const noPrompt = await t.run(
      "builder",
      "new",
      "--wix-instance",
      "S1",
      "--json",
    );
    t.expectResult(noPrompt).toFail();
    expect(JSON.parse(noPrompt.stdout).error).toContain("prompt");
    const orphanId = await t.run(
      "builder",
      "new",
      "x",
      "--wix-client-id",
      "c1",
      "--json",
    );
    t.expectResult(orphanId).toFail();
    expect(JSON.parse(orphanId.stdout).error).toContain("--wix-instance");
  });

  it("new --wix-instance - reads the token from stdin", async () => {
    await t.givenLoggedIn(USER);
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/wix/create-app", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({ app_id: "wix-3", client_creation_id: "initial-ghi" });
    });
    t.api.mockRoute("GET", "/api/apps/wix-3/branches", (_req, res) =>
      res.json([]),
    );
    t.api.mockRoute(
      "GET",
      "/api/apps/wix-3/chat/full-conversation",
      (_req, res) =>
        res.json({
          messages: [
            {
              id: "u1",
              role: "user",
              content: "x",
              outcome: { backend_status: "success_build" },
            },
          ],
        }),
    );
    t.api.mockRoute("GET", "/api/apps/wix-3", (_req, res) =>
      res.json({ id: "wix-3", status: { state: "ready" } }),
    );
    t.api.mockRoute("GET", "/api/apps/wix-3/sandbox/preview-url", (_req, res) =>
      res.json({ preview_url: "preview-wix-3.base44.app" }),
    );
    t.givenStdin("FROM.STDIN\n");
    const result = await t.run(
      "builder",
      "new",
      "x",
      "--wix-instance",
      "-",
      "--name",
      "spa3",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBody).toEqual({ prompt: "x", signed_instance: "FROM.STDIN" });
  });

  it("new validates its inputs before calling the API", async () => {
    await t.givenLoggedIn(USER);
    t.expectResult(await t.run("builder", "new", "--json")).toFail();
    t.expectResult(
      await t.run("builder", "new", "x", "--mode", "fork", "--json"),
    ).toFail();
    t.expectResult(
      await t.run("builder", "new", "x", "--name", "no/slashes", "--json"),
    ).toFail();
  });

  it("send scopes to the sole active branch and surfaces the reply", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/apps/test-app-id", (_req, res) =>
      res.json({ id: "test-app-id", status: { state: "ready" } }),
    );
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
      "builder",
      "send",
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

  it("send reports a queued turn instead of inventing a reply", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/apps/test-app-id", (_req, res) =>
      res.json({ id: "test-app-id", status: { state: "ready" } }),
    );
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.json([]),
    );
    t.api.mockRoute("POST", "/api/apps/test-app-id/chat/message", (_req, res) =>
      res.json({ queued: true }),
    );
    const result = await t.run(
      "builder",
      "send",
      "one more thing",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({ queued: true });
  });

  it("send --stream-json emits one JSON line per event, then a result line", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/apps/test-app-id", (_req, res) =>
      res.json({ id: "test-app-id", status: { state: "ready" } }),
    );
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.json([]),
    );
    t.api.mockRoute("POST", "/api/apps/test-app-id/chat/message", (_req, res) =>
      res.json({
        id: "test-app-id",
        status: { state: "ready" },
        conversation: {
          id: "conv-1",
          messages: [
            { role: "user", content: "add login" },
            { role: "assistant", content: "Done: session-based login." },
          ],
        },
      }),
    );
    const result = await t.run(
      "builder",
      "send",
      "add login",
      "--app-id",
      "test-app-id",
      "--stream-json",
    );
    t.expectResult(result).toSucceed();
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((l: string) => JSON.parse(l));
    expect(lines.at(-1)).toEqual({
      type: "result",
      queued: false,
      status: "ready",
      error_source: null,
      reply: "Done: session-based login.",
    });
    for (const line of lines) expect(typeof line.type).toBe("string");
  });

  const parkedConversation = (call: Record<string, unknown>) => ({
    messages: [
      {
        id: "u1",
        role: "user",
        content: "add a store",
        outcome: { backend_status: "success_build" },
      },
      {
        id: "m1",
        role: "assistant",
        content: "I need your go-ahead.",
        tool_calls: [
          {
            id: "tc1",
            status: "waiting_for_user_input",
            results: "waiting",
            ...call,
          },
        ],
      },
    ],
  });
  const appReady = () =>
    t.api.mockRoute("GET", "/api/apps/test-app-id", (_req, res) =>
      res.json({ id: "test-app-id", status: { state: "ready" } }),
    );
  const noBranches = () =>
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.json([]),
    );

  it("send reports status waiting with what the agent asked, and refuses a new message meanwhile", async () => {
    await t.givenLoggedIn(USER);
    appReady();
    noBranches();
    t.api.mockRoute(
      "GET",
      "/api/apps/test-app-id/chat/full-conversation",
      (_req, res) =>
        res.json(
          parkedConversation({
            name: "enable_connector",
            arguments_string: JSON.stringify({
              integration_type: "wix_stores",
              summary: "Sell the pillows",
            }),
          }),
        ),
    );
    const blocked = await t.run(
      "builder",
      "send",
      "another thing",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(blocked).toSucceed();
    expect(JSON.parse(blocked.stdout)).toEqual({
      status: "waiting",
      pending: [
        {
          id: "tc1",
          kind: "approval",
          tool: "enable_connector",
          title: "Enable wix_stores?",
          detail: "Sell the pillows",
        },
      ],
    });
    const status = await t.run(
      "builder",
      "status",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(status).toSucceed();
    expect(JSON.parse(status.stdout).state).toBe("waiting");
  });

  it("send --approve answers the pending call through submit-tool-call-input", async () => {
    await t.givenLoggedIn(USER);
    appReady();
    noBranches();
    // Parked until the answer lands; settled after it.
    let answered = false;
    t.api.mockRoute(
      "GET",
      "/api/apps/test-app-id/chat/full-conversation",
      (_req, res) =>
        res.json(
          answered
            ? {
                messages: [
                  {
                    id: "u2",
                    role: "user",
                    content: "I approved: Sell",
                    outcome: { backend_status: "success_build" },
                  },
                ],
              }
            : parkedConversation({
                name: "enable_connector",
                arguments_string: JSON.stringify({
                  integration_type: "wix_stores",
                  summary: "Sell",
                }),
              }),
        ),
    );
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute(
      "POST",
      "/api/apps/test-app-id/chat/submit-tool-call-input",
      (req, res) => {
        answered = true;
        sentBody = req.body as Record<string, unknown>;
        return res.json({
          id: "test-app-id",
          status: { state: "ready" },
          conversation: {
            id: "c",
            messages: [{ role: "assistant", content: "Connector enabled." }],
          },
        });
      },
    );
    const result = await t.run(
      "builder",
      "send",
      "--approve",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBody).toEqual({
      tool_call_id: "tc1",
      action: "approved",
      extra_user_input: {},
      message_id: "m1",
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "ready",
      reply: "Connector enabled.",
    });
  });

  it("send --choose validates against the options and builds the web payload", async () => {
    await t.givenLoggedIn(USER);
    appReady();
    noBranches();
    t.api.mockRoute(
      "GET",
      "/api/apps/test-app-id/chat/full-conversation",
      (_req, res) =>
        res.json(
          parkedConversation({
            name: "ask_clarifying_questions",
            arguments_string: JSON.stringify({
              questions: [
                {
                  question: "Layout?",
                  options: [{ label: "Grid" }, { label: "List" }],
                },
                {
                  question: "Sections?",
                  multi_select: true,
                  options: [{ label: "Hero" }, { label: "FAQ" }],
                },
              ],
            }),
          }),
        ),
    );
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute(
      "POST",
      "/api/apps/test-app-id/chat/submit-tool-call-input",
      (req, res) => {
        sentBody = req.body as Record<string, unknown>;
        return res.json({ id: "test-app-id", status: { state: "ready" } });
      },
    );
    const bad = await t.run(
      "builder",
      "send",
      "--choose",
      "Tiles",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(bad).toFail();
    expect(JSON.parse(bad.stdout).error).toContain("not an option");
    const ok = await t.run(
      "builder",
      "send",
      "--choose",
      "List",
      "--choose",
      "Hero,FAQ",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(ok).toSucceed();
    expect(sentBody?.extra_user_input).toEqual({
      answers: [
        { question_index: 0, selected_label: "List" },
        { question_index: 1, selected_labels: ["Hero", "FAQ"] },
      ],
    });
  });

  it("send --secret takes values from the environment and refuses plain text", async () => {
    await t.givenLoggedIn(USER);
    appReady();
    noBranches();
    t.api.mockRoute(
      "GET",
      "/api/apps/test-app-id/chat/full-conversation",
      (_req, res) =>
        res.json(
          parkedConversation({
            name: "set_secrets",
            arguments_string: JSON.stringify({
              secrets_schema: [
                { secretName: "STRIPE_KEY", description: "dashboard" },
              ],
            }),
          }),
        ),
    );
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute(
      "POST",
      "/api/apps/test-app-id/chat/submit-tool-call-input",
      (req, res) => {
        sentBody = req.body as Record<string, unknown>;
        return res.json({ id: "test-app-id", status: { state: "ready" } });
      },
    );
    const plain = await t.run(
      "builder",
      "send",
      "--secret",
      "STRIPE_KEY=sk_live_plain",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(plain).toFail();
    expect(JSON.parse(plain.stdout).error).toContain("never as plain text");
    t.givenEnv({ MY_STRIPE: "sk_live_from_env" });
    const ok = await t.run(
      "builder",
      "send",
      "--secret",
      "STRIPE_KEY=env:MY_STRIPE",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(ok).toSucceed();
    expect(sentBody?.extra_user_input).toEqual({
      secrets: { STRIPE_KEY: "sk_live_from_env" },
    });
    expect(ok.stdout).not.toContain("sk_live_from_env");
  });

  it("send refuses a code-first project (base44 create)", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/apps/test-app-id", (_req, res) =>
      res.json({ id: "test-app-id", is_managed_source_code: false }),
    );
    const result = await t.run(
      "builder",
      "send",
      "hi",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain("code-first");
  });

  it("send refuses a Superagent", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/apps/test-app-id", (_req, res) =>
      res.json({ id: "test-app-id", app_type: "user_agent" }),
    );
    const result = await t.run(
      "builder",
      "send",
      "hi",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain("Superagent");
  });

  it("status reports the app's build state", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/apps/test-app-id", (_req, res) =>
      res.json({
        id: "test-app-id",
        status: { state: "processing", message: "building" },
      }),
    );
    const result = await t.run(
      "builder",
      "status",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      id: "test-app-id",
      state: "processing",
      message: "building",
    });
  });

  it("preview prints a clickable preview URL", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute(
      "GET",
      "/api/apps/test-app-id/sandbox/preview-url",
      (_req, res) => res.json({ preview_url: "3000-x.e2b.app" }),
    );
    const result = await t.run(
      "sandbox",
      "preview",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toEqual({
      preview_url: "https://3000-x.e2b.app",
    });
  });

  it("stop halts the turn on the active branch", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/apps/test-app-id/branches", (_req, res) =>
      res.json([
        { id: "b1", branch_name: "base44/setup-abc", status: "active" },
      ]),
    );
    let sentBranchId: unknown;
    t.api.mockRoute("POST", "/api/apps/test-app-id/chat/stop", (req, res) => {
      sentBranchId = req.query.branch_id;
      return res.json({});
    });
    const result = await t.run(
      "builder",
      "stop",
      "--app-id",
      "test-app-id",
      "--json",
    );
    t.expectResult(result).toSucceed();
    expect(sentBranchId).toBe("b1");
    expect(JSON.parse(result.stdout)).toEqual({ stopped: true });
  });

  it("code refuses to run without a terminal", async () => {
    await t.givenLoggedIn(USER);
    const result = await t.run("code", "--json");
    t.expectResult(result).toFail();
    expect(JSON.parse(result.stdout).error).toContain("terminal");
  });
  it("model lists the catalog with the current pick", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/auth/me", (_req, res) =>
      res.json({ id: "u1", ...USER, builder_model: "claude_opus_5" }),
    );
    const result = await t.run("builder", "model", "--json");
    t.expectResult(result).toSucceed();
    const out = JSON.parse(result.stdout);
    expect(out.current).toBe("claude_opus_5");
    expect(out.models.map((m: { name: string }) => m.name)).toContain("Opus 5");
  });

  it("model <name> persists the pick to the account", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/auth/me", (_req, res) =>
      res.json({ id: "u1", ...USER, builder_model: null }),
    );
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/auth/u1/update-user", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({});
    });
    const result = await t.run("builder", "model", "sonnet", "--json");
    t.expectResult(result).toSucceed();
    expect(sentBody).toEqual({ builder_model: "claude-sonnet-5" });
    expect(JSON.parse(result.stdout)).toEqual({ current: "claude-sonnet-5" });
  });

  it("model default clears the pick so Base44 chooses (Automatic)", async () => {
    await t.givenLoggedIn(USER);
    t.api.mockRoute("GET", "/api/auth/me", (_req, res) =>
      res.json({ id: "u1", ...USER, builder_model: "claude_opus_5" }),
    );
    let sentBody: Record<string, unknown> | undefined;
    t.api.mockRoute("POST", "/api/auth/u1/update-user", (req, res) => {
      sentBody = req.body as Record<string, unknown>;
      return res.json({});
    });
    const result = await t.run("builder", "model", "default", "--json");
    t.expectResult(result).toSucceed();
    expect(sentBody).toEqual({ builder_model: null });
    expect(JSON.parse(result.stdout)).toEqual({ current: null });
  });
});
