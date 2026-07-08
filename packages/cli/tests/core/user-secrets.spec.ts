import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushUserSecrets } from "../../src/core/resources/user-secret/api.js";

const mockPut = vi.fn();
vi.mock("../../src/core/clients/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/core/clients/index.js")>();
  return { ...actual, getAppClient: () => ({ put: mockPut }) };
});

describe("pushUserSecrets", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends metadata-only definitions using the platform API shape", async () => {
    mockPut.mockResolvedValue({
      json: () =>
        Promise.resolve([
          {
            id: "definition-1",
            key: "provider_api_key",
            label: "Provider API key",
            description: "",
            allowed_backend_functions: ["call-provider"],
            version: 1,
            is_active: true,
          },
        ]),
    });

    await pushUserSecrets([
      {
        name: "provider_api_key",
        label: "Provider API key",
        description: "",
        allowedFunctions: ["call-provider"],
      },
    ]);

    expect(mockPut).toHaveBeenCalledWith("app-user-secret-definitions", {
      json: [
        {
          key: "provider_api_key",
          label: "Provider API key",
          description: "",
          allowed_backend_functions: ["call-provider"],
        },
      ],
    });
  });

  it("syncs an empty directory so removed definitions are disabled", async () => {
    mockPut.mockResolvedValue({ json: () => Promise.resolve([]) });

    await pushUserSecrets([]);

    expect(mockPut).toHaveBeenCalledWith("app-user-secret-definitions", {
      json: [],
    });
  });
});
