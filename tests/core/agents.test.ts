import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../../src/core/resources/agent/index.js";
import { pushAgents } from "../../src/core/resources/agent/api.js";

// Mock the HTTP client
const mockPut = vi.fn();
vi.mock("../../src/core/clients/index.js", () => ({
  getAppClient: () => ({
    put: mockPut,
  }),
}));


describe("pushAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends empty configs array when no agents provided (deletes all remote)", async () => {
    mockPut.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ created: [], updated: [], deleted: ["old_agent"] }),
    });

    const result = await pushAgents([]);

    expect(mockPut).toHaveBeenCalledWith("agent-configs", {
      json: { configs: [] },
      throwHttpErrors: false,
    });
    expect(result.deleted).toEqual(["old_agent"]);
  });

  it("sends configs when agents are provided", async () => {
    const agents: AgentConfig[] = [
      {
        name: "test_agent",
        description: "Test",
        instructions: "Do stuff",
        tool_configs: [{ allowed_operations: ["read", "create", "update", "delete"], entity_name: "User" }],
        whatsapp_greeting: "Hello!",
      },
    ];

    mockPut.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ created: ["test_agent"], updated: [], deleted: [] }),
    });

    const result = await pushAgents(agents);

    expect(mockPut).toHaveBeenCalledWith("agent-configs", {
      json: {
        configs: [
          {
            name: "test_agent",
            description: "Test",
            instructions: "Do stuff",
            tool_configs: [{ allowed_operations: ["read", "create", "update", "delete"], entity_name: "User" }],
            whatsapp_greeting: "Hello!",
          },
        ],
      },
      throwHttpErrors: false,
    });
    expect(result.created).toEqual(["test_agent"]);
  });

  it("handles null whatsapp_greeting when not provided", async () => {
    const agents = [
      {
        name: "agent_no_greeting",
        description: "Test",
        instructions: "Do stuff",
        tool_configs: [],
      },
    ];

    mockPut.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ created: ["agent_no_greeting"], updated: [], deleted: [] }),
    });

    await pushAgents(agents);

    expect(mockPut).toHaveBeenCalledWith("agent-configs", {
      json: {
        configs: [
          {
            name: "agent_no_greeting",
            description: "Test",
            instructions: "Do stuff",
            tool_configs: [],
            whatsapp_greeting: null,
          },
        ],
      },
      throwHttpErrors: false,
    });
  });

  it("throws error when API returns error", async () => {
    mockPut.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ detail: "Unauthorized" }),
    });

    await expect(pushAgents([])).rejects.toThrow(
      "Error occurred while syncing agents: Unauthorized"
    );
  });
});
