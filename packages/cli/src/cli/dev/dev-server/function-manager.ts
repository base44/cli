import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import getPort from "get-port";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { InternalError, InvalidInputError } from "@/core/errors.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";
import { verifyDenoInstalled } from "@/core/utils/index.js";

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
  private logger: DevLogger;
  private wrapperPath: string;

  constructor(
    functions: BackendFunction[],
    logger: DevLogger,
    wrapperPath: string,
  ) {
    this.functions = new Map(functions.map((f) => [f.name, f]));
    this.logger = logger;
    this.wrapperPath = wrapperPath;

    if (functions.length > 0) {
      verifyDenoInstalled("to run backend functions locally");
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
      if (!this.starting.has(name) && this.running.has(name)) {
        // We can end up here if user called `stopAll()` while one of the processes is being initialized.
        // In this case we need to kill the process, to avoid zombies running around.
        this.running.get(name)?.process.kill();
        this.running.delete(name);
      }
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

  async reload(functions: BackendFunction[]): Promise<void> {
    await this.stopAll();
    this.functions = new Map(functions.map((f) => [f.name, f]));
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      Array.from(this.running, ([name, { process: proc }]) => {
        this.logger.log(`Stopping function: ${name}`);
        const exited = new Promise<void>((r) => proc.once("exit", () => r()));
        if (process.platform === "win32" && proc.pid) {
          spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
        } else {
          proc.kill();
        }
        return exited;
      }),
    );
    this.running.clear();
    this.starting.clear();
  }

  private async allocatePort(): Promise<number> {
    const usedPorts = Array.from(this.running.values()).map((r) => r.port);
    return getPort({ exclude: usedPorts });
  }

  private spawnFunction(func: BackendFunction, port: number): ChildProcess {
    this.logger.log(`Spawning function "${func.name}" on port ${port}`);

    const process = spawn("deno", ["run", "--allow-all", this.wrapperPath], {
      env: {
        ...globalThis.process.env,
        FUNCTION_PATH: pathToFileURL(func.entryPath).href,
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
      // `code === null` happens when process is terminated by a signal.
      // In this case I'm assuming that it's happening as part of the reload mechanism.
      // In other words there is no need to log `code` information, if we ourselve killed the process.
      if (code !== null) {
        this.logger.log(`Function "${name}" exited with code ${code}`);
      }
      this.running.delete(name);
    });

    process.on("error", (error) => {
      this.logger.error(`Function "${name}" error:`, error);
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
