import { describe, expect, it } from "vitest";
import { AgentConfigSchema } from "@/core/resources/agent/schema.js";

const baseAgent = {
  name: "support",
  description: "Help desk",
  instructions: "Be helpful",
};

describe("AgentConfigSchema memory_config", () => {
  it("fills backend-matching defaults for a partial memory_config", () => {
    const result = AgentConfigSchema.safeParse({
      ...baseAgent,
      memory_config: { scope: "user" },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected agent config to parse");
    }

    // readAllAgents deploys the parsed object, so defaults here are what we push.
    expect(result.data.memory_config).toEqual({
      enabled: true,
      scope: "user",
      include_other_conversation_context: false,
    });
  });

  it("accepts an agent without memory_config", () => {
    const result = AgentConfigSchema.safeParse(baseAgent);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected agent config to parse");
    }
    expect(result.data.memory_config).toBeUndefined();
  });

  it("rejects an unknown memory scope the backend also rejects", () => {
    const result = AgentConfigSchema.safeParse({
      ...baseAgent,
      memory_config: { scope: "per_user" },
    });

    expect(result.success).toBe(false);
  });

  it("preserves unknown pass-through fields (model, skills) via looseObject", () => {
    const result = AgentConfigSchema.safeParse({
      ...baseAgent,
      model: "claude_sonnet_4_6",
      selected_skill_names: ["billing-help"],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected agent config to parse");
    }
    expect(result.data.model).toBe("claude_sonnet_4_6");
    expect(result.data.selected_skill_names).toEqual(["billing-help"]);
  });

  it("parses selected_skill_names and passes through selected_workspace_skill_ids", () => {
    const parsed = AgentConfigSchema.parse({
      name: "helper",
      description: "d",
      instructions: "i",
      selected_skill_names: ["weekly-report"],
      selected_workspace_skill_ids: ["6512f2a1b3c4d5e6f7a8b9c0"],
    });
    expect(parsed.selected_skill_names).toEqual(["weekly-report"]);
    // looseObject keeps unknown workspace ids without a typed field
    expect(
      (parsed as Record<string, unknown>).selected_workspace_skill_ids,
    ).toEqual(["6512f2a1b3c4d5e6f7a8b9c0"]);
  });

  it("defaults selected_skill_names to an empty array", () => {
    const parsed = AgentConfigSchema.parse({
      name: "helper",
      description: "d",
      instructions: "i",
    });
    expect(parsed.selected_skill_names).toEqual([]);
  });
});

describe("AgentConfigSchema server route tools", () => {
  const routeTool = {
    tool_name: "convert_time",
    route_path: "/api/zuri/convert-time",
    method: "get",
    description: "Converts a time between zones",
  };

  it("round-trips a route tool unchanged", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [routeTool],
    });

    expect(parsed.tool_configs).toEqual([routeTool]);
  });

  it("fills backend-matching defaults when method and description are omitted", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [{ tool_name: "sync", route_path: "/api/sync" }],
    });

    expect(parsed.tool_configs).toEqual([
      {
        tool_name: "sync",
        route_path: "/api/sync",
        method: "post",
        description: "agent server route",
      },
    ]);
  });

  it.each([
    ["a tool_name with a space", { tool_name: "convert time" }],
    ["a tool_name over 64 characters", { tool_name: "a".repeat(65) }],
    ["a blank route_path", { route_path: "  " }],
    ["a route_path starting with //", { route_path: "//evil.example/x" }],
    ["a route_path that is not app-relative", { route_path: "api/x" }],
    ["a route_path with a query string", { route_path: "/api/x?y=1" }],
    [
      "a route_path over 2000 characters",
      { route_path: `/${"a".repeat(2000)}` },
    ],
    ["a method the backend does not allow", { method: "head" }],
  ])("rejects %s", (_label, override) => {
    const result = AgentConfigSchema.safeParse({
      ...baseAgent,
      tool_configs: [{ ...routeTool, ...override }],
    });

    expect(result.success).toBe(false);
  });
});
