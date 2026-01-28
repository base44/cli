import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile, cp, readFile } from "node:fs/promises";
import { vi } from "vitest";
import { dir } from "tmp-promise";
import type { Command } from "commander";
import { CLIResultMatcher } from "./CLIResultMatcher.js";
import { Base44APIMock } from "./Base44APIMock.js";
import type { CLIResult } from "./CLIResultMatcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_INDEX_PATH = join(__dirname, "../../../dist/index.js");

/** Type for the bundled program module */
interface ProgramModule {
  program: Command;
  CLIExitError: new (code: number) => Error & { code: number };
}

export class CLITestkit {
  private tempDir: string;
  private cleanupFn: () => Promise<void>;
  private env: Record<string, string> = {};
  private projectDir?: string;

  /** Typed API mock for Base44 endpoints */
  readonly api: Base44APIMock;

  private constructor(tempDir: string, cleanupFn: () => Promise<void>, appId: string) {
    this.tempDir = tempDir;
    this.cleanupFn = cleanupFn;
    this.api = new Base44APIMock(appId);
    // Set HOME to temp dir for auth file isolation
    // Set CI to prevent browser opens during tests
    this.env = { HOME: tempDir, CI: "true" };
  }

  /** Factory method - creates isolated test environment */
  static async create(appId: string = "test-app-id"): Promise<CLITestkit> {
    const { path, cleanup } = await dir({ unsafeCleanup: true });
    return new CLITestkit(path, cleanup, appId);
  }

  /** Get the temp directory path */
  getTempDir(): string {
    return this.tempDir;
  }

  // ─── GIVEN METHODS ────────────────────────────────────────────

  /** Set up authenticated user state */
  async givenLoggedIn(user: { email: string; name: string }): Promise<void> {
    const authDir = join(this.tempDir, ".base44", "auth");
    await mkdir(authDir, { recursive: true });
    await writeFile(
      join(authDir, "auth.json"),
      JSON.stringify({
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        expiresAt: Date.now() + 3600000, // 1 hour from now
        email: user.email,
        name: user.name,
      })
    );
  }

  /** Set up project directory by copying fixture to temp dir */
  async givenProject(fixturePath: string): Promise<void> {
    this.projectDir = join(this.tempDir, "project");
    await cp(fixturePath, this.projectDir, { recursive: true });
  }

  // ─── WHEN METHODS ─────────────────────────────────────────────

  /** Execute CLI command */
  async run(...args: string[]): Promise<CLIResult> {
    // Reset modules to clear any cached state (e.g., refreshPromise)
    vi.resetModules();

    // Setup mocks
    this.setupCwdMock();
    this.setupEnvOverrides();

    // Save original env values for cleanup
    const originalEnv = this.captureEnvSnapshot();

    // Set testkit environment variables
    Object.assign(process.env, this.env);

    // Setup output capture
    const { stdout, stderr, stdoutSpy, stderrSpy } = this.setupOutputCapture();

    // Setup process.exit mock
    const { exitState, originalExit } = this.setupExitMock();

    // Apply all API mocks before running
    this.api.apply();

    // Dynamic import after vi.resetModules() to get fresh module instances
    const { program, CLIExitError } = (await import(DIST_INDEX_PATH)) as ProgramModule;

    const buildResult = (exitCode: number): CLIResult => ({
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode,
    });

    try {
      await program.parseAsync(["node", "base44", ...args]);
      return buildResult(0);
    } catch (e) {
      // process.exit() was called - our mock throws after capturing the code
      // This catches Commander's exits for --help, --version, unknown options
      if (exitState.code !== null) { return buildResult(exitState.code); }
      // CLI's clean exit mechanism (thrown by runCommand on errors)
      if (e instanceof CLIExitError) { return buildResult(e.code); }
      // Unexpected error - let it bubble up
      throw e;
    } finally {
      // Restore process.exit
      process.exit = originalExit;
      // Restore environment variables
      this.restoreEnvSnapshot(originalEnv);
      // Restore mocks
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
      vi.restoreAllMocks();
    }
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────

  private setupCwdMock(): void {
    if (this.projectDir) {
      vi.spyOn(process, "cwd").mockReturnValue(this.projectDir);
    }
  }

  private setupEnvOverrides(): void {
    if (this.projectDir) {
      this.env.BASE44_CLI_TEST_OVERRIDES = JSON.stringify({
        appConfig: { id: this.api.appId, projectRoot: this.projectDir },
      });
    }
  }

  /** Save original values of env vars we're about to modify */
  private captureEnvSnapshot(): { HOME?: string; BASE44_CLI_TEST_OVERRIDES?: string; CI?: string } {
    return {
      HOME: process.env.HOME,
      BASE44_CLI_TEST_OVERRIDES: process.env.BASE44_CLI_TEST_OVERRIDES,
      CI: process.env.CI,
    };
  }

  /** Restore env vars to their original values (or delete if they didn't exist) */
  private restoreEnvSnapshot(snapshot: { HOME?: string; BASE44_CLI_TEST_OVERRIDES?: string; CI?: string }): void {
    for (const key of ["HOME", "BASE44_CLI_TEST_OVERRIDES", "CI"] as const) {
      if (snapshot[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = snapshot[key];
      }
    }
  }

  private setupOutputCapture() {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    return { stdout, stderr, stdoutSpy, stderrSpy };
  }

  private setupExitMock() {
    const exitState = { code: null as number | null };
    const originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitState.code = code ?? 0;
      throw new Error(`process.exit called with ${code}`);
    }) as typeof process.exit;

    return { exitState, originalExit };
  }

  // ─── THEN METHODS ─────────────────────────────────────────────

  /** Create assertion helper for CLI result */
  expect(result: CLIResult): CLIResultMatcher {
    return new CLIResultMatcher(result);
  }

  /** Read the auth file created by login */
  async readAuthFile(): Promise<Record<string, unknown> | null> {
    const authPath = join(this.tempDir, ".base44", "auth", "auth.json");
    try {
      const content = await readFile(authPath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // ─── CLEANUP ──────────────────────────────────────────────────

  async cleanup(): Promise<void> {
    await this.cleanupFn();
  }
}
