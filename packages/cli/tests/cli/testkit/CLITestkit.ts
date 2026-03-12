import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { dir } from "tmp-promise";
import type { CLIResult } from "./CLIResultMatcher.js";
import { CLIResultMatcher } from "./CLIResultMatcher.js";
import { TestAPIServer } from "./TestAPIServer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, "../../..");

type TestRunnerMode = "npm" | "binary";

const TEST_RUNNER: TestRunnerMode =
  (process.env.CLI_TEST_RUNNER as TestRunnerMode) || "npm";

/** Resolve the platform-specific compiled binary path */
function getBinaryPath(): string {
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const ext = process.platform === "win32" ? ".exe" : "";
  return join(CLI_ROOT, `dist/binaries/base44-${platform}-${arch}${ext}`);
}

/** Resolve the npm entry point (node bin/run.js) */
function getNpmEntryPath(): string {
  return join(CLI_ROOT, "bin/run.js");
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

  /** Real HTTP server for Base44 API endpoints */
  readonly api: TestAPIServer;

  private constructor(
    tempDir: string,
    cleanupFn: () => Promise<void>,
    api: TestAPIServer,
  ) {
    this.tempDir = tempDir;
    this.cleanupFn = cleanupFn;
    this.api = api;
    // Set HOME to temp dir for auth file isolation
    // Set CI to prevent browser opens during tests
    // Disable telemetry to prevent error reporting during tests
    this.env = { HOME: tempDir, CI: "true", BASE44_DISABLE_TELEMETRY: "1" };
  }

  /** Factory method - creates isolated test environment */
  static async create(appId = "test-app-id"): Promise<CLITestkit> {
    const { path, cleanup } = await dir({ unsafeCleanup: true });
    const api = new TestAPIServer(appId);
    await api.start();
    return new CLITestkit(path, cleanup, api);
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
      }),
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

  /** Spawn the CLI as a child process and execute the command */
  async run(...args: string[]): Promise<CLIResult> {
    this.setupEnvOverrides();

    const env: Record<string, string> = {
      ...this.env,
      BASE44_API_URL: this.api.baseUrl,
      PATH: process.env.PATH ?? "",
    };

    this.api.apply();

    const execArgs =
      TEST_RUNNER === "binary"
        ? { file: getBinaryPath(), args }
        : { file: "node", args: [getNpmEntryPath(), ...args] };

    const result = await execa(execArgs.file, execArgs.args, {
      cwd: this.projectDir ?? this.tempDir,
      env,
      reject: false,
      all: false,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 1,
    };
  }

  // ─── PRIVATE HELPERS ───────────────────────────────────────────

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
    await this.api.stop();
    await this.cleanupFn();
  }
}
