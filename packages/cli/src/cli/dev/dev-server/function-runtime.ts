import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { FunctionManager } from "@/cli/dev/dev-server/function-manager.js";
import { MiniflareFunctionManager } from "@/cli/dev/dev-server/miniflare-function-manager.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";

/** What the dev server needs from a local function runtime. */
export interface FunctionRuntime {
  getFunctionNames(): string[];
  /** Start (or reuse) the function and return the local port serving it. */
  ensureRunning(name: string): Promise<number>;
  reload(functions: BackendFunction[]): Promise<void>;
  stopAll(): Promise<void>;
}

/**
 * Picks the local function runtime.
 *
 * Default is workerd via Miniflare — the deployed runtime, giving
 * `base44:runtime` (secrets, waitUntil) its production semantics. Falls back
 * to the Deno subprocess when miniflare cannot be resolved (the compiled
 * standalone binary cannot embed workerd's native executable) or when forced
 * with B44_DEV_FUNCTIONS_RUNTIME=deno.
 *
 * Availability is probed with a dynamic import of miniflare itself — the
 * manager and bundler modules import their heavy dependencies lazily, so
 * importing *them* succeeds everywhere and says nothing about whether the
 * runtime can actually load.
 */
export async function createFunctionRuntime(
  functions: BackendFunction[],
  logger: DevLogger,
  denoWrapperPath: string,
): Promise<FunctionRuntime> {
  const forced = process.env.B44_DEV_FUNCTIONS_RUNTIME;

  if (forced !== "deno" && functions.length > 0) {
    try {
      await import("miniflare");
      return new MiniflareFunctionManager(functions, logger);
    } catch (error) {
      if (forced === "workerd") {
        throw error;
      }
      logger.log(
        "workerd runtime unavailable in this installation — running functions with Deno",
      );
    }
  }

  return new FunctionManager(functions, logger, denoWrapperPath);
}
