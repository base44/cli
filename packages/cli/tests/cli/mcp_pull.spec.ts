import { describe, expect, it } from "vitest";
import { fixture, setupCLITests } from "./testkit/index.js";

describe("mcp pull command", () => {
  const t = setupCLITests();

  it("writes the remote config to base44/mcp/config.json", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("basic"));
    t.api.mockMcpConfigFetch({
      config: { auth: "none", tools: { excluded_agents: ["helper"] } },
      tools: [{ name: "Task_read" }],
      pending_removal: [],
    });

    // When
    const result = await t.run("mcp", "pull");

    // Then
    t.expectResult(result).toSucceed();
    t.expectResult(result).toContain("Pulled MCP config to");
    const content = await t.readProjectFile("base44/mcp/config.json");
    expect(JSON.parse(content ?? "")).toEqual({
      auth: "none",
      tools: { excluded_agents: ["helper"] },
    });
  });

  it("replaces a local file that is not valid JSON", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("invalid-mcp-json"));
    t.api.mockMcpConfigFetch({
      config: { auth: "oauth" },
      tools: [],
      pending_removal: [],
    });

    // When
    const result = await t.run("mcp", "pull");

    // Then
    t.expectResult(result).toSucceed();
    const content = await t.readProjectFile("base44/mcp/config.json");
    expect(JSON.parse(content ?? "")).toEqual({ auth: "oauth" });
  });

  it("leaves the local file alone when the app has no remote config", async () => {
    // Given
    await t.givenLoggedInWithProject(fixture("with-mcp"));
    t.api.mockMcpConfigFetch({ config: null, tools: [], pending_removal: [] });

    // When
    const result = await t.run("mcp", "pull", "--json");

    // Then
    t.expectResult(result).toSucceed();
    expect(JSON.parse(result.stdout)).toMatchObject({
      config: null,
      written: false,
    });
    const content = await t.readProjectFile("base44/mcp/config.json");
    expect(JSON.parse(content ?? "").auth).toBe("oauth");
  });
});
