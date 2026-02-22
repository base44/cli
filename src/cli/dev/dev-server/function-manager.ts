import type { ChildProcess } from "node:child_process";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import getPort from "get-port";
import {
  DependencyNotFoundError,
  InternalError,
  InvalidInputError,
} from "@/core/errors.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";
import type { Logger } from "../createDevLogger";

const __dirname = dirname(fileURLToPath(import.meta.url));

const WRAPPER_PATH = join(__dirname, "../deno-runtime/main.js");

const READY_TIMEOUT = 30000;

interface RunningFunction {
  process: ChildProcess;
  port: number;
  ready: boolean;
}

export class FunctionManager {
  private functions: Map<string, BackendFunction>;
  private running: Map<string, RunningFunction> = new Map();
  private starting: Map<string, Promise<number>> = new Map();
  private logger: Logger;

  constructor(functions: BackendFunction[], logger: Logger) {
    this.functions = new Map(functions.map((f) => [f.name, f]));
    this.logger = logger;

    if (functions.length > 0) {
      this.verifyDenoIsInstalled();
    }
  }

  private verifyDenoIsInstalled(): void {
    const result = spawnSync("deno", ["--version"]);
    if (result.error) {
      throw new DependencyNotFoundError("Deno is required to run functions", {
        hints: [{ message: "Install Deno from https://deno.com/download" }],
      });
    }
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
    if (existing?.ready) {
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
      this.starting.delete(name);
    }
  }

  private async startFunction(
    name: string,
    backendFunction: BackendFunction,
  ): Promise<number> {
    const port = await this.allocatePort();
    const process = this.spawnFunction(backendFunction, port);

    const runningFunc: RunningFunction = {
      process,
      port,
      ready: false,
    };

    this.running.set(name, runningFunc);
    this.setupProcessHandlers(name, process);

    return this.waitForReady(name, runningFunc);
  }

  stopAll(): void {
    for (const [name, { process }] of this.running) {
      this.logger.log(`[dev-server] Stopping function: ${name}`);
      process.kill();
    }
    this.running.clear();
    this.starting.clear();
  }

  private async allocatePort(): Promise<number> {
    const usedPorts = Array.from(this.running.values()).map((r) => r.port);
    return getPort({ exclude: usedPorts });
  }

  private spawnFunction(func: BackendFunction, port: number): ChildProcess {
    this.logger.log(
      `[dev-server] Spawning function "${func.name}" on port ${port}`,
    );

    const process = spawn("deno", ["run", "--allow-all", WRAPPER_PATH], {
      env: {
        ...globalThis.process.env,
        FUNCTION_PATH: func.entryPath,
        FUNCTION_PORT: String(port),
        FUNCTION_NAME: func.name,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    return process;
  }

  private setupProcessHandlers(name: string, process: ChildProcess): void {
    // Pipe stdout with function name prefix
    process.stdout?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        this.logger.log(line);
      }
    });

    // Pipe stderr with function name prefix
    process.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        this.logger.error(line);
      }
    });

    process.on("exit", (code) => {
      this.logger.log(
        `[dev-server] Function "${name}" exited with code ${code}`,
      );
      this.running.delete(name);
    });

    process.on("error", (error) => {
      this.logger.error(`[dev-server] Function "${name}" error:`, error);
      this.running.delete(name);
    });
  }

  private waitForReady(
    name: string,
    runningFunc: RunningFunction,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      runningFunc.process.on("exit", (code) => {
        if (!runningFunc.ready) {
          clearTimeout(timeout);
          reject(
            new InternalError(`Function "${name}" exited with code ${code}`, {
              hints: [{ message: "Check the function code for errors" }],
            }),
          );
        }
      });

      const timeout = setTimeout(() => {
        runningFunc.process.kill();
        reject(
          new InternalError(
            `Function "${name}" failed to start within ${READY_TIMEOUT / 1000}s timeout`,
            {
              hints: [
                { message: "Check the function code for startup errors" },
              ],
            },
          ),
        );
      }, READY_TIMEOUT);

      const onData = (data: Buffer) => {
        const output = data.toString();
        // We relay on the fact that logic in `deno-runtime/main.ts` will print `Listening on` when function is up and ready.
        if (output.includes("Listening on")) {
          runningFunc.ready = true;
          clearTimeout(timeout);
          runningFunc.process.stdout?.off("data", onData);
          resolve(runningFunc.port);
        }
      };

      runningFunc.process.stdout?.on("data", onData);
    });
  }
}
