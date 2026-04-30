import { describe, expect, it } from "vitest";
import { AgentConfigSchema } from "../../src/core/resources/agent/schema.js";

const baseAgent = {
  name: "support",
  description: "Help desk",
  instructions: "Be helpful",
};

describe("AgentConfigSchema - code_mode tool_config value", () => {
  it("accepts code_mode: true", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [{ code_mode: true }],
    });
    expect(parsed.tool_configs).toEqual([{ code_mode: true }]);
  });

  it("accepts code_mode: false", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [{ code_mode: false }],
    });
    expect(parsed.tool_configs).toEqual([{ code_mode: false }]);
  });

  it("accepts an empty capabilities object", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [{ code_mode: {} }],
    });
    expect(parsed.tool_configs).toEqual([{ code_mode: {} }]);
  });

  it("accepts a populated capabilities object", () => {
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [{ code_mode: { filesystem: true } }],
    });
    expect(parsed.tool_configs).toEqual([{ code_mode: { filesystem: true } }]);
  });

  it("rejects a string value", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        tool_configs: [{ code_mode: "yes" }],
      }),
    ).toThrow();
  });

  it("rejects a number value", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        tool_configs: [{ code_mode: 1 }],
      }),
    ).toThrow();
  });

  it("rejects a null value", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        tool_configs: [{ code_mode: null }],
      }),
    ).toThrow();
  });

  it("rejects an array value", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        tool_configs: [{ code_mode: ["filesystem"] }],
      }),
    ).toThrow();
  });

  it("rejects an entry that does not match any tool_config variant", () => {
    expect(() =>
      AgentConfigSchema.parse({
        ...baseAgent,
        tool_configs: [{ unknown_field: true }],
      }),
    ).toThrow();
  });
});

describe("AgentConfigSchema - tool_configs union dispatch", () => {
  it("parses an entity entry without altering it", () => {
    const entry = {
      entity_name: "Order",
      allowed_operations: ["read", "create"],
    };
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [entry],
    });
    expect(parsed.tool_configs).toEqual([entry]);
  });

  it("parses a backend function entry without altering it", () => {
    const entry = {
      function_name: "send_email",
      description: "Send an email",
    };
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [entry],
    });
    expect(parsed.tool_configs).toEqual([entry]);
  });

  it("parses a code_mode entry without altering it", () => {
    const entry = { code_mode: true };
    const parsed = AgentConfigSchema.parse({
      ...baseAgent,
      tool_configs: [entry],
    });
    expect(parsed.tool_configs).toEqual([entry]);
  });

  it("preserves a mixed tool_configs array containing all three variants", () => {
    const tool_configs = [
      { entity_name: "Order", allowed_operations: ["read", "create"] },
      {
        function_name: "send_email",
        description: "Send a transactional email",
      },
      { code_mode: true },
    ];
    const parsed = AgentConfigSchema.parse({ ...baseAgent, tool_configs });
    expect(parsed.tool_configs).toEqual(tool_configs);
  });
});
