import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";
import { BaseFunctionManager } from "@/cli/dev/dev-server/base-function-manager.js";
import { InternalError } from "@/core/errors.js";
import type { BackendFunction } from "@/core/resources/function/schema.js";
import { verifyDenoInstalled } from "@/core/utils/index.js";

const READY_TIMEOUT = 30000;

interface RunningFunction {
  process: ChildProcess;
  port: number;
  ready: boolean;
}

/**
 * Runs each function in a Deno subprocess via the backend-runtime wrapper.
 * Fallback runtime — the default is workerd (miniflare-function-manager.ts);
 * see function-runtime.ts for how the choice is made.
 */
export class FunctionManager extends BaseFunctionManager<RunningFunction> {
  private wrapperPath: string;

  constructor(
    functions: BackendFunction[],
    logger: DevLogger,
    wrapperPath: string,
  ) {
    super(functions, logger);
    this.wrapperPath = wrapperPath;

    if (functions.length > 0) {
      verifyDenoInstalled("to run backend functions locally");
    }
  }

  protected override isReady(running: RunningFunction): boolean {
    return running.ready;
  }

  protected async startFunction(
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

  protected async stopFunction(
    _name: string,
    { process: proc }: RunningFunction,
  ): Promise<void> {
    const exited = new Promise<void>((r) => proc.once("exit", () => r()));
    if (process.platform === "win32" && proc.pid) {
      spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"]);
    } else {
      proc.kill();
    }
    await exited;
  }

  private spawnFunction(func: BackendFunction, port: number): ChildProcess {
    this.logger.log(`Spawning function "${func.name}" on port ${port}`);

    // Maps the `base44:runtime` specifier onto the local shim so functions
    // written for the deployed runtime resolve their imports here too. Shipped
    // alongside the wrapper in the same assets directory.
    //
    // Deliberately only this map, not merged with the project's own deno.json.
    // Deno never applied that config here anyway — it resolves config from the
    // entry point, which is this wrapper, outside the project — and deploy
    // uploads only files under `base44/`, so a project-level alias could never
    // resolve server-side. Supporting one locally would mean code that runs in
    // `base44 dev` and fails on deploy.
    const importMapPath = join(dirname(this.wrapperPath), "import-map.json");

    const process = spawn(
      "deno",
      ["run", "--allow-all", "--import-map", importMapPath, this.wrapperPath],
      {
        env: {
          ...globalThis.process.env,
          FUNCTION_PATH: pathToFileURL(func.entryPath).href,
          FUNCTION_PORT: String(port),
          FUNCTION_NAME: func.name,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

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
        // We relay on the fact that logic in `backend-runtime/main.ts` will print `Listening on` when function is up and ready.
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
