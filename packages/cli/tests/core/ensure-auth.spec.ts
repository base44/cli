import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/cli/commands/auth/login-flow.js", () => ({ login: vi.fn() }));
vi.mock("@/core/auth/index.js", () => ({
  hasWorkspaceApiKeyAuth: vi.fn(),
  isLoggedIn: vi.fn(),
  readAuth: vi.fn(),
  seedAuthFromEnv: vi.fn(),
}));

import { login } from "@/cli/commands/auth/login-flow.js";
import type { CLIContext } from "@/cli/types.js";
import { ensureAuth } from "@/cli/utils/command/middleware.js";
import { isLoggedIn } from "@/core/auth/index.js";
import { AuthRequiredError } from "@/core/errors.js";

// The CLI testkit spawns the CLI without a TTY, so the interactive path is
// covered here, in process.
function contextWith(isNonInteractive: boolean): CLIContext {
  return {
    isNonInteractive,
    log: { info: vi.fn() },
    errorReporter: { setContext: vi.fn() },
  } as unknown as CLIContext;
}

describe("ensureAuth while logged out", () => {
  beforeEach(() => {
    vi.mocked(isLoggedIn).mockResolvedValue(false);
  });

  it("starts the login in an interactive terminal", async () => {
    const ctx = contextWith(false);

    await ensureAuth(ctx);

    expect(login).toHaveBeenCalledWith(ctx);
  });

  it("fails with AuthRequiredError, without a login, when non-interactive", async () => {
    await expect(ensureAuth(contextWith(true))).rejects.toThrow(
      AuthRequiredError,
    );

    expect(login).not.toHaveBeenCalled();
  });
});
