import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceId } from "../../src/cli/commands/project/workspace-select.js";
import type { CLIContext } from "../../src/cli/types.js";
import { ApiError } from "../../src/core/errors.js";
import { listWorkspaces } from "../../src/core/workspace/api.js";

vi.mock("../../src/core/workspace/api.js");

const listWorkspacesMock = vi.mocked(listWorkspaces);

function makeContext(): { ctx: CLIContext; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  const ctx = {
    isNonInteractive: false,
    jsonMode: false,
    distribution: "npm",
    log: {
      info: vi.fn(),
      success: vi.fn(),
      warn,
      error: vi.fn(),
      step: vi.fn(),
      message: vi.fn(),
    },
    // Execute the task body directly with a no-op message updater.
    runTask: (async (_start, op) => op(() => {})) as CLIContext["runTask"],
  } as unknown as CLIContext;
  return { ctx, warn };
}

describe("resolveWorkspaceId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("passes an explicit --workspace id straight through without an API call", async () => {
    const { ctx } = makeContext();

    const result = await resolveWorkspaceId(ctx, "ws-123", true);

    expect(result).toBe("ws-123");
    expect(listWorkspacesMock).not.toHaveBeenCalled();
  });

  it("returns undefined without listing workspaces in non-interactive mode", async () => {
    const { ctx } = makeContext();

    const result = await resolveWorkspaceId(ctx, undefined, false);

    expect(result).toBeUndefined();
    expect(listWorkspacesMock).not.toHaveBeenCalled();
  });

  it("falls back to the default workspace when the token can't list workspaces (403)", async () => {
    const { ctx, warn } = makeContext();
    listWorkspacesMock.mockRejectedValue(
      new ApiError("Error listing workspaces: forbidden", {
        statusCode: 403,
      }),
    );

    const result = await resolveWorkspaceId(ctx, undefined, true);

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("--workspace");
  });

  it("rethrows non-403 errors instead of silently falling back", async () => {
    const { ctx } = makeContext();
    listWorkspacesMock.mockRejectedValue(
      new ApiError("Error listing workspaces: server error", {
        statusCode: 500,
      }),
    );

    await expect(resolveWorkspaceId(ctx, undefined, true)).rejects.toThrow(
      /server error/,
    );
  });

  it("returns undefined when the user has only their personal workspace", async () => {
    const { ctx } = makeContext();
    listWorkspacesMock.mockResolvedValue([
      {
        id: "personal",
        name: "Personal",
        isPersonal: true,
      } as Awaited<ReturnType<typeof listWorkspaces>>[number],
    ]);

    const result = await resolveWorkspaceId(ctx, undefined, true);

    expect(result).toBeUndefined();
  });
});
