import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import getPort from "get-port";
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
  private logger: Logger;

  constructor(functions: BackendFunction[], logger: Logger) {
    this.functions = new Map(functions.map((f) => [f.name, f]));
    this.logger = logger;
  }

  getFunction(name: string): BackendFunction | undefined {
    return this.functions.get(name);
  }

  /**
   * Ensure a function is running and return its port.
   * If the function is already running, returns immediately.
   * If not, spawns a new Deno process and waits for it to be ready.
   */
  async ensureRunning(name: string): Promise<number> {
    const existing = this.running.get(name);
    if (existing?.ready) {
      return existing.port;
    }

    const backendFunction = this.functions.get(name);
    if (!backendFunction) {
      throw new Error(`Function "${name}" not found`);
    }

    // If process exists but not ready, wait for it
    if (existing && !existing.ready) {
      return this.waitForReady(name, existing);
    }

    // Spawn new process
    const port = await this.allocatePort();
    const process = this.spawnFunction(backendFunction, port);

    const runningFunc: RunningFunction = {
      process,
      port,
      ready: false,
    };

    this.running.set(name, runningFunc);

    // Set up process event handlers
    this.setupProcessHandlers(name, process);

    // Wait for the function to be ready
    return this.waitForReady(name, runningFunc);
  }

  getPort(name: string): number | undefined {
    const running = this.running.get(name);
    return running?.ready ? running.port : undefined;
  }

  stopAll(): void {
    for (const [name, { process }] of this.running) {
      this.logger.log(`[dev-server] Stopping function: ${name}`);
      process.kill();
    }
    this.running.clear();
  }

  stop(name: string): void {
    const running = this.running.get(name);
    if (running) {
      this.logger.log(`Stopping function: ${name}`);
      running.process.kill();
      this.running.delete(name);
    }
  }

  private async allocatePort(): Promise<number> {
    const usedPorts = Array.from(this.running.values()).map((r) => r.port);
    return getPort({ exclude: usedPorts });
  }

  private spawnFunction(func: BackendFunction, port: number): ChildProcess {
    this.logger.log(
      `[dev-server] Spawning function "${func.name}" on port ${port}`
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

    // Handle process exit
    process.on("exit", (code) => {
      this.logger.log(
        `[dev-server] Function "${name}" exited with code ${code}`
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
    runningFunc: RunningFunction
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Function "${name}" failed to start within timeout`));
      }, READY_TIMEOUT);

      // Listen for the "Listening on" message to detect readiness
      const onData = (data: Buffer) => {
        const output = data.toString();
        if (output.includes("Listening on")) {
          runningFunc.ready = true;
          clearTimeout(timeout);
          runningFunc.process.stdout?.off("data", onData);
          resolve(runningFunc.port);
        }
      };

      runningFunc.process.stdout?.on("data", onData);

      // Also handle early exit
      runningFunc.process.on("exit", (code) => {
        if (!runningFunc.ready) {
          clearTimeout(timeout);
          reject(new Error(`Function "${name}" exited with code ${code}`));
        }
      });
    });
  }
}
