import getPort from "get-port";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
// Type-only, so the value-level cycle (function-runtime → function-manager →
// here) never exists at runtime.
import type { FunctionRuntime } from "@/cli/dev/dev-server/function-runtime.js";
import { InvalidInputError } from "@/core/errors.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";

/**
 * Shared lifecycle for local function runtimes: the name → function map,
 * start-deduplication, port allocation and teardown. Subclasses provide only
 * how one function starts and stops.
 */
export abstract class BaseFunctionManager<R extends { port: number }>
  implements FunctionRuntime
{
  protected functions: Map<string, BackendFunction>;
  protected running: Map<string, R> = new Map();
  private starting: Map<string, Promise<number>> = new Map();
  protected logger: DevLogger;

  constructor(functions: BackendFunction[], logger: DevLogger) {
    this.functions = new Map(functions.map((f) => [f.name, f]));
    this.logger = logger;
  }

  /**
   * Start one function, register it in `this.running`, and resolve with its
   * port once it can serve requests.
   */
  protected abstract startFunction(
    name: string,
    backendFunction: BackendFunction,
  ): Promise<number>;

  /** Stop one running function and release its resources. */
  protected abstract stopFunction(name: string, running: R): Promise<void>;

  /** Whether a registered function is ready to serve. */
  protected isReady(_running: R): boolean {
    return true;
  }

  getFunctionNames(): string[] {
    return Array.from(this.functions.keys());
  }

  async ensureRunning(name: string): Promise<number> {
    const backendFunction = this.functions.get(name);
    if (!backendFunction) {
      throw new InvalidInputError(`Function "${name}" not found`, {
        hints: [{ message: "Check available functions in your project" }],
      });
    }

    const existing = this.running.get(name);
    if (existing && this.isReady(existing)) {
      return existing.port;
    }

    const pending = this.starting.get(name);
    if (pending) {
      return pending;
    }

    const promise = this.startFunction(name, backendFunction);
    this.starting.set(name, promise);

    try {
      return await promise;
    } finally {
      if (!this.starting.has(name) && this.running.has(name)) {
        // stopAll() ran while this function was starting — stop the straggler
        // so it doesn't leak.
        const running = this.running.get(name);
        if (running) {
          void this.stopFunction(name, running);
        }
        this.running.delete(name);
      }
      this.starting.delete(name);
    }
  }

  async reload(functions: BackendFunction[]): Promise<void> {
    await this.stopAll();
    this.functions = new Map(functions.map((f) => [f.name, f]));
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.running, async ([name, running]) => {
        this.logger.log(`Stopping function: ${name}`);
        await this.stopFunction(name, running);
      }),
    );
    this.running.clear();
    this.starting.clear();
  }

  protected async allocatePort(): Promise<number> {
    const usedPorts = Array.from(this.running.values()).map((r) => r.port);
    return getPort({ exclude: usedPorts });
  }
}
