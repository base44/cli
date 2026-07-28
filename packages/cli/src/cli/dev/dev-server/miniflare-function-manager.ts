import type { Readable } from "node:stream";
import type { Miniflare } from "miniflare";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { BaseFunctionManager } from "@/cli/dev/dev-server/base-function-manager.js";
import {
  bundleFunction,
  disposeBundler,
  FunctionBundleError,
} from "@/cli/dev/dev-server/function-bundler.js";
import { InternalError } from "@/core/errors.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";

// Dynamic for the same reason as in function-bundler.ts: miniflare is an
// external runtime dependency, and a hoisted static import would load it on
// every CLI invocation and crash the compiled standalone binary at launch.
type MiniflareModule = typeof import("miniflare");

let miniflareModulePromise: Promise<MiniflareModule> | undefined;

function loadMiniflare(): Promise<MiniflareModule> {
  miniflareModulePromise ??= import("miniflare");
  return miniflareModulePromise;
}

// Must be supported by the workerd that ships with the *exact-pinned*
// miniflare dependency — bump the two together. A floating miniflare range
// bit us here once: an install resolved an older 4.x whose workerd rejected
// this date and every function failed with "The Workers runtime failed to
// start".
const COMPATIBILITY_DATE = "2026-06-01";

interface RunningFunction {
  miniflare: Miniflare;
  port: number;
}

/**
 * Runs backend functions in workerd via Miniflare — the deployed runtime, not
 * an emulation. Each function is bundled (function-bundler.ts) and served on
 * its own local port so the existing proxy in routes/functions.ts works
 * unchanged. Secrets arrive as Worker env bindings, exactly as deployed; the
 * binding values come from the environment `base44 dev` was started with, so
 * a production secret is never copied onto the developer machine.
 *
 * Only reachable through the dynamic-import boundary in function-runtime.ts.
 */
export class MiniflareFunctionManager extends BaseFunctionManager<RunningFunction> {
  constructor(functions: BackendFunction[], logger: DevLogger) {
    super(functions, logger);
  }

  protected async startFunction(
    name: string,
    backendFunction: BackendFunction,
  ): Promise<number> {
    this.logger.log(`Bundling function "${name}"`);

    let code: string;
    try {
      ({ code } = await bundleFunction(backendFunction.entryPath));
    } catch (error) {
      if (error instanceof FunctionBundleError) {
        throw new InternalError(
          `Function "${name}" failed to bundle:\n${error.message}`,
          { hints: [{ message: "Check the function code for errors" }] },
        );
      }
      throw error;
    }

    const { Miniflare } = await loadMiniflare();
    const port = await this.allocatePort();
    this.logger.log(`Starting function "${name}" on port ${port}`);

    // Miniflare registers its own SIGINT/SIGTERM handlers that call
    // process.exit(128 + signal) immediately — racing (and losing) against
    // the dev server's graceful shutdown, which disposes every instance and
    // lets the event loop drain to a clean exit 0. Snapshot the listeners
    // around instance creation and strip whatever it added; its `exit` hook
    // (which reaps a workerd orphan on abnormal exit) is left untouched.
    const signals = ["SIGINT", "SIGTERM"] as const;
    const before = new Map(
      signals.map((s) => [s, new Set(process.listeners(s))]),
    );
    const stripAddedSignalListeners = () => {
      for (const signal of signals) {
        for (const listener of process.listeners(signal)) {
          if (!before.get(signal)?.has(listener)) {
            process.removeListener(signal, listener);
          }
        }
      }
    };

    const miniflare = new Miniflare({
      modules: [{ type: "ESModule", path: `/${name}.mjs`, contents: code }],
      modulesRoot: "/",
      compatibilityDate: COMPATIBILITY_DATE,
      compatibilityFlags: ["nodejs_compat"],
      host: "127.0.0.1",
      port,
      // The same env the Deno runtime exposed via process inheritance, now
      // delivered the way production delivers secrets: as env bindings.
      bindings: collectStringEnv(),
      handleRuntimeStdio: (stdout: Readable, stderr: Readable) => {
        pipeLines(stdout, (line) => this.logger.log(line));
        pipeLines(stderr, (line) => this.logger.error(line));
      },
    });

    try {
      await miniflare.ready;
    } catch (error) {
      await miniflare.dispose();
      throw new InternalError(
        `Function "${name}" failed to start: ${error instanceof Error ? error.message : String(error)}`,
        { hints: [{ message: "Check the function code for startup errors" }] },
      );
    } finally {
      stripAddedSignalListeners();
    }

    this.running.set(name, { miniflare, port });
    return port;
  }

  protected async stopFunction(
    _name: string,
    { miniflare }: RunningFunction,
  ): Promise<void> {
    await miniflare.dispose();
  }

  override async stopAll(): Promise<void> {
    await super.stopAll();
    // Without this the esbuild service process keeps the event loop alive and
    // the dev server never exits after SIGINT (the CLI never calls
    // process.exit). esbuild restarts the service on the next build, so a
    // reload after this is fine.
    await disposeBundler();
  }
}

function collectStringEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

function pipeLines(stream: Readable, write: (line: string) => void): void {
  stream.on("data", (data: Buffer) => {
    for (const line of data.toString().trim().split("\n")) {
      if (line.trim().length > 0) {
        write(line);
      }
    }
  });
}
