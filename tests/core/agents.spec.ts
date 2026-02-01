import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentConfig } from "../../src/core/resources/agent/index.js";
import { pushAgents } from "../../src/core/resources/agent/api.js";

// Mock the HTTP client
const mockPut = vi.fn();
vi.mock("../../src/core/clients/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/clients/index.js")>();
  return {
    ...actual,
    getAppClient: () => ({
      put: mockPut,
    }),
  };
});

/**
 * Creates a mock HTTP error object for testing error handling.
 * Simulates ky's HTTPError structure without requiring exact type match.
 */
function createMockHTTPError(status: number, body: unknown) {
  const response = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

  const error = new Error(`Request failed with status code ${status}`) as Error & {
    name: string;
    response: Response;
  };
  error.name = "HTTPError";
  error.response = response;

  return error;
}

describe("pushAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result without API call when no agents provided", async () => {
    const result = await pushAgents([]);

    expect(mockPut).not.toHaveBeenCalled();
    expect(result).toEqual({ created: [], updated: [], deleted: [] });
  });

  it("sends list of configs when agents are provided", async () => {
    const agents: AgentConfig[] = [
      {
        name: "test_agent",
        description: "Test",
        instructions: "Do stuff",
        tool_configs: [
          { allowed_operations: ["read", "create", "update", "delete"], entity_name: "User" },
        ],
        whatsapp_greeting: "Hello!",
      },
    ];

    mockPut.mockResolvedValue({
      json: () => Promise.resolve({ created: ["test_agent"], updated: [], deleted: [] }),
    });

    const result = await pushAgents(agents);

    expect(mockPut).toHaveBeenCalledWith("agent-configs", {
      json: [
        {
          name: "test_agent",
          description: "Test",
          instructions: "Do stuff",
          tool_configs: [
            { allowed_operations: ["read", "create", "update", "delete"], entity_name: "User" },
          ],
          whatsapp_greeting: "Hello!",
        },
      ],
    });
    expect(result.created).toEqual(["test_agent"]);
  });

  it("passes agents through as-is", async () => {
    const agents = [
      {
        name: "agent_no_greeting",
        description: "Test",
        instructions: "Do stuff",
        tool_configs: [],
      },
    ];

    mockPut.mockResolvedValue({
      json: () => Promise.resolve({ created: ["agent_no_greeting"], updated: [], deleted: [] }),
    });

    await pushAgents(agents);

    expect(mockPut).toHaveBeenCalledWith("agent-configs", {
      json: [
        {
          name: "agent_no_greeting",
          description: "Test",
          instructions: "Do stuff",
          tool_configs: [],
        },
      ],
    });
  });

  it("throws ApiError with message when API returns error", async () => {
    const agents: AgentConfig[] = [
      {
        name: "test_agent",
        description: "Test",
        instructions: "Do stuff",
        tool_configs: [],
      },
    ];

    mockPut.mockRejectedValue(
      createMockHTTPError(401, {
        error_type: "HTTPException",
        message: "Unauthorized access",
        detail: "Token expired",
      })
    );

    await expect(pushAgents(agents)).rejects.toThrow("Error syncing agents: Unauthorized access");
  });

  it("falls back to detail when message is not present", async () => {
    const agents: AgentConfig[] = [
      {
        name: "test_agent",
        description: "Test",
        instructions: "Do stuff",
        tool_configs: [],
      },
    ];

    mockPut.mockRejectedValue(createMockHTTPError(400, { detail: "Some error detail" }));

    await expect(pushAgents(agents)).rejects.toThrow("Error syncing agents: Some error detail");
  });

  it("stringifies object errors", async () => {
    const agents: AgentConfig[] = [
      {
        name: "test_agent",
        description: "Test",
        instructions: "Do stuff",
        tool_configs: [],
      },
    ];

    mockPut.mockRejectedValue(
      createMockHTTPError(422, {
        error_type: "ValidationError",
        message: { field: "name", error: "required" },
        detail: [{ loc: ["name"], msg: "field required" }],
      })
    );

    await expect(pushAgents(agents)).rejects.toThrow(
      'Error syncing agents: {\n  "field": "name",\n  "error": "required"\n}'
    );
  });
});
