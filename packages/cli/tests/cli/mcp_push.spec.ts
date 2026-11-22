import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

const MCP_PATH = "/api/apps/platform/test-app-id/mcp/config";

describe("mcp push command", () => {
  const t = setupCLITests();

  it("pushes the local config as strict JSON and reports the surface", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-mcp"));
    let body: unknown;
    t.api.mockRoute("PUT", MCP_PATH, (req, res) => {
      body = req.body;
      res.status(200).json({
        config: req.body.config,
        tools: [{ name: "Customer_read" }, { name: "Customer_create" }],
        pending_removal: [],
      });
    });

    // When
    const result = await t.run("mcp", "push");

    // Then
    t.expectResult(result).toSucceed();
    expect(body).toEqual({
      config: {
        auth: "oauth",
        tools: {
          excluded_agents: ["internal_helper"],
          entity_overrides: {
            Customer: { operations: ["read", "create"] },
          },
        },
      },
    });
    t.expectResult(result).toContain("MCP config pushed successfully");
    t.expectResult(result).toContain(
      "2 tools exposed: Customer_read, Customer_create",
    );
    t.expectResult(result).toContain("deployed at least once");
    t.expectResult(result).toContain("/oauth/consent");
  });

  it("emits the resolved surface as JSON under --json", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-mcp"));
    t.api.mockMcpConfigPush({
      config: { auth: "oauth" },
      tools: [{ name: "Customer_read" }],
      pending_removal: ["Old_tool"],
    });

    // When
    const result = await t.run("mcp", "push", "--json");

    // Then
    t.expectResult(result).toSucceed();
    const output = JSON.parse(result.stdout);
    expect(output.config).toEqual({ auth: "oauth" });
    expect(output.tools).toEqual([{ name: "Customer_read" }]);
    expect(output.pendingRemoval).toEqual(["Old_tool"]);
    expect(output.notes).toHaveLength(2);
  });

  it("surfaces the platform's invalid_mcp_config message", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-mcp"));
    t.api.mockMcpConfigPushError({
      status: 400,
      body: {
        error: {
          code: "invalid_mcp_config",
          message: 'tools.functions[0]: unknown key "hander"',
          details: null,
        },
      },
    });

    // When
    const result = await t.run("mcp", "push");

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain(
      'Error pushing MCP config: tools.functions[0]: unknown key "hander" (invalid_mcp_config)',
    );
  });

  it("fails on invalid local JSON before any request", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("invalid-mcp-json"));
    let requested = false;
    t.api.mockRoute("PUT", MCP_PATH, (_req, res) => {
      requested = true;
      res.status(200).json({ config: null, tools: [], pending_removal: [] });
    });

    // When
    const result = await t.run("mcp", "push");

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("invalid JSON");
    t.expectResult(result).toContain("strict JSON");
    expect(requested).toBe(false);
  });

  it("pushes nothing when there is no local config", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("basic"));
    let requested = false;
    t.api.mockRoute("PUT", MCP_PATH, (_req, res) => {
      requested = true;
      res.status(200).json({ config: null, tools: [], pending_removal: [] });
    });

    // When
    const result = await t.run("mcp", "push");

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("nothing to push");
    expect(requested).toBe(false);
  });
});

describe("mcp delete command", () => {
  const t = setupCLITests();

  it("requires --yes in non-interactive mode", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-mcp"));

    // When
    const result = await t.run("mcp", "delete");

    // Then
    t.expectResult(result).toFail();
    t.expectResult(result).toContain("--yes is required");
  });

  it("sends a null config to take the server down", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-mcp"));
    let body: unknown;
    t.api.mockRoute("PUT", MCP_PATH, (req, res) => {
      body = req.body;
      res.status(200).json({ config: null, tools: [], pending_removal: [] });
    });

    // When
    const result = await t.run("mcp", "delete", "--yes");

    // Then
    t.expectResult(result).toSucceed();
    expect(body).toEqual({ config: null });
    t.expectResult(result).toContain("MCP server is down");
    expect(await t.fileExists("base44/mcp/config.json")).toBe(true);
  });
});
