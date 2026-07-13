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
});
