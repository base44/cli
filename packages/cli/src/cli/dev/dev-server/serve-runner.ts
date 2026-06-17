import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import process from "node:process";
import type { DevLogger } from "@/cli/dev/createDevLogger.js";

interface ServeRunnerOptions {
  command: string;
  cwd: string;
  env: Record<string, string>;
  logger: DevLogger;
}

export class ServeRunner {
  private readonly command: string;
  private readonly cwd: string;
  private readonly env: Record<string, string>;
  private readonly logger: DevLogger;
  private child?: ChildProcess;
  private stopping = false;
  private stopPromise?: Promise<void>;
  private readonly exitListeners: Array<(code: number | null) => void> = [];

  constructor(options: ServeRunnerOptions) {
    this.command = options.command;
    this.cwd = options.cwd;
    this.env = options.env;
    this.logger = options.logger;
  }

  start(): void {
    if (this.child) {
      return;
    }
    const stdin = process.platform === "win32" ? "ignore" : "inherit";
    const child = spawn(this.command, {
      cwd: this.cwd,
      shell: true,
      // A dedicated process group lets stop() tree-kill `npm -> vite`.
      detached: process.platform !== "win32",
      env: { ...process.env, ...this.env },
      stdio: [stdin, "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.setupHandlers(child);
  }

  onExit(listener: (code: number | null) => void): void {
    this.exitListeners.push(listener);
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }
    this.stopPromise = this.stopChild();
    return this.stopPromise;
  }

  private async stopChild(): Promise<void> {
    const child = this.child;
    if (!child || child.exitCode !== null) {
      return;
    }
    this.stopping = true;
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    if (process.platform === "win32" && child.pid) {
      const taskkill = spawn(
        "taskkill",
        ["/pid", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      await new Promise<void>((resolve) => {
        taskkill.once("exit", () => resolve());
        taskkill.once("error", () => resolve());
      });
    } else if (child.pid) {
      // Negative pid targets the whole process group (the shell + its children).
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill();
      }
    }
    await exited;
  }

  private setupHandlers(child: ChildProcess): void {
    child.stdout?.on("data", (data: Buffer) => this.emitLines(data, "log"));
    child.stderr?.on("data", (data: Buffer) => this.emitLines(data, "error"));

    child.on("error", (error) => {
      this.logger.error("Frontend dev server failed to start:", error);
      this.notifyExit(null);
    });

    child.on("exit", (code) => {
      if (this.stopping) {
        return;
      }
      this.logger.error(`Frontend dev server exited with code ${code}`);
      this.notifyExit(code);
    });
  }

  private notifyExit(code: number | null): void {
    for (const listener of this.exitListeners) {
      listener(code);
    }
  }

  private emitLines(data: Buffer, type: "log" | "error"): void {
    const lines = data.toString().trimEnd().split("\n");
    for (const line of lines) {
      if (type === "error") {
        this.logger.error(line);
      } else {
        this.logger.log(line);
      }
    }
  }
}
