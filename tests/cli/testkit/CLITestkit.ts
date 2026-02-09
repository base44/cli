import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import { dir } from "tmp-promise";
import { vi } from "vitest";
import { Base44APIMock } from "./Base44APIMock.js";
import type { CLIResult } from "./CLIResultMatcher.js";
import { CLIResultMatcher } from "./CLIResultMatcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_INDEX_PATH = join(__dirname, "../../../dist/cli/index.js");

/** Type for CLIContext */
interface CLIContext {
  errorReporter: {
    setContext: (context: Record<string, unknown>) => void;
    getErrorContext: () => { sessionId?: string; appId?: string };
  };
}

/** Type for the bundled program module */
interface ProgramModule {
  createProgram: (context: CLIContext) => Command;
  CLIExitError: new (code: number) => Error & { code: number };
}

/** Test overrides that get serialized to BASE44_CLI_TEST_OVERRIDES */
interface TestOverrides {
  appConfig?: { id: string; projectRoot: string };
  latestVersion?: string | null;
}

export class CLITestkit {
  private tempDir: string;
  private cleanupFn: () => Promise<void>;
  private env: Record<string, string> = {};
  private projectDir?: string;
  // Default latestVersion to null to skip npm version check in tests
  private testOverrides: TestOverrides = { latestVersion: null };

  /** Typed API mock for Base44 endpoints */
  readonly api: Base44APIMock;

  private constructor(
    tempDir: string,
    cleanupFn: () => Promise<void>,
    appId: string
  ) {
    this.tempDir = tempDir;
    this.cleanupFn = cleanupFn;
    this.api = new Base44APIMock(appId);
    // Set HOME to temp dir for auth file isolation
    // Set CI to prevent browser opens during tests
    // Disable telemetry to prevent error reporting during tests
    this.env = { HOME: tempDir, CI: "true", BASE44_DISABLE_TELEMETRY: "1" };
  }

  /** Factory method - creates isolated test environment */
  static async create(appId = "test-app-id"): Promise<CLITestkit> {
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

  /**
   * Set the latest version for upgrade check.
   * - Pass a version string (e.g., "1.0.0") to simulate an upgrade available
   * - Pass null to simulate no upgrade available (default)
   * - Pass undefined to test the real npm version check (not recommended, makes network call)
   */
  givenLatestVersion(version: string | null | undefined): void {
    this.testOverrides.latestVersion = version;
  }

  // ─── WHEN METHODS ─────────────────────────────────────────────

  /** Execute CLI command */
  async run(...args: string[]): Promise<CLIResult> {
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

    // Reset module state to ensure test isolation
    vi.resetModules();

    // Import CLI module fresh after reset
    const { createProgram, CLIExitError } = (await import(
      DIST_INDEX_PATH
    )) as ProgramModule;

    // Create a mock context for tests (telemetry is disabled via env var anyway)
    const mockContext: CLIContext = {
      errorReporter: {
        setContext: () => {},
        getErrorContext: () => ({ sessionId: "test-session" }),
      },
    };
    const program = createProgram(mockContext);

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
      if (exitState.code !== null) {
        return buildResult(exitState.code);
      }
      // CLI's clean exit mechanism (user cancellation, etc.)
      if (e instanceof CLIExitError) {
        return buildResult(e.code);
      }
      // Any other error = command failed with exit code 1
      // Capture error message in stderr for test assertions
      const errorMessage =
        e instanceof Error ? (e.stack ?? e.message) : String(e);
      stderr.push(errorMessage);
      return buildResult(1);
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
      this.testOverrides.appConfig = {
        id: this.api.appId,
        projectRoot: this.projectDir,
      };
    }
    if (Object.keys(this.testOverrides).length > 0) {
      this.env.BASE44_CLI_TEST_OVERRIDES = JSON.stringify(this.testOverrides);
    }
  }

  private captureEnvSnapshot(): Record<string, string | undefined> {
    const snapshot: Record<string, string | undefined> = {};
    for (const key of Object.keys(this.env)) {
      snapshot[key] = process.env[key];
    }
    return snapshot;
  }

  private restoreEnvSnapshot(
    snapshot: Record<string, string | undefined>
  ): void {
    for (const key of Object.keys(snapshot)) {
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

    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });
    const stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk) => {
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

  /** Read a file from the project directory */
  async readProjectFile(relativePath: string): Promise<string | null> {
    if (!this.projectDir) {
      throw new Error("No project set up. Call givenProject() first.");
    }
    try {
      return await readFile(join(this.projectDir, relativePath), "utf-8");
    } catch {
      return null;
    }
  }

  /** Check if a file exists in the project directory */
  async fileExists(relativePath: string): Promise<boolean> {
    if (!this.projectDir) {
      throw new Error("No project set up. Call givenProject() first.");
    }
    try {
      await access(join(this.projectDir, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  // ─── CLEANUP ──────────────────────────────────────────────────

  async cleanup(): Promise<void> {
    await this.cleanupFn();
  }
}
