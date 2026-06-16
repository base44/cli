import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const BASE44_APP_ID_ENV_VAR = "BASE44_APP_ID";

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

/** Handle to a running CLI process started by `runLive()` */
export interface RunLiveHandle {
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  waitForOutput(pattern: string | RegExp, timeoutMs?: number): Promise<void>;
  stop(): Promise<CLIResult>;
}

/** Test overrides that get serialized to BASE44_CLI_TEST_OVERRIDES */
interface TestOverrides {
  appConfig?: { id: string; projectRoot: string };
  latestVersion?: string | null;
}

export class CLITestkit {
  private tempDir: string;
  private env: Record<string, string> = {};
  private projectDir?: string;
  // Default latestVersion to null to skip npm version check in tests
  private testOverrides: TestOverrides = { latestVersion: null };
  private stdinContent: string | undefined = undefined;
  private liveHandles: RunLiveHandle[] = [];

  /** Real HTTP server for Base44 API endpoints */
  readonly api: TestAPIServer;

  private constructor(tempDir: string, api: TestAPIServer) {
    this.tempDir = tempDir;
    this.api = api;
    // Set HOME to temp dir for auth file isolation
    // On Windows, os.homedir() reads USERPROFILE, so set both
    // Set CI to prevent browser opens during tests
    // Disable telemetry to prevent error reporting during tests
    this.env = {
      HOME: tempDir,
      ...(process.platform === "win32" ? { USERPROFILE: tempDir } : {}),
      CI: "true",
      // I cannot simply pass `NODE_ENV` to the `env` property in `execa`.
      // It eventually gets overridden in the child process, causing `NODE_ENV` to default to `development`.
      // To overcome this, I am introducing a unique environment variable.
      IS_TEST: process.env.NODE_ENV === "test" ? "true" : "false",
      BASE44_DISABLE_TELEMETRY: "1",
    };
  }

  /** Factory method - creates isolated test environment */
  static async create(appId = "test-app-id"): Promise<CLITestkit> {
    const { path } = await dir({ unsafeCleanup: true });
    const api = new TestAPIServer(appId);
    await api.start();
    return new CLITestkit(path, api);
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

  /** Simulate piped stdin for the next run() call */
  givenStdin(content: string): void {
    this.stdinContent = content;
  }

  /** Set additional environment variables for subsequent run()/runLive() calls */
  givenEnv(vars: Record<string, string>): void {
    this.env = { ...this.env, ...vars };
  }

  // ─── WHEN METHODS ─────────────────────────────────────────────

  /** Spawn the CLI as a child process and execute the command */
  async run(...args: string[]): Promise<CLIResult> {
    this.setupEnvOverrides();

    const env: Record<string, string | undefined> = {
      ...this.env,
      [BASE44_APP_ID_ENV_VAR]: this.env[BASE44_APP_ID_ENV_VAR],
      BASE44_API_URL: this.api.baseUrl,
      PATH: process.env.PATH ?? "",
    };

    this.api.apply();

    const execArgs =
      TEST_RUNNER === "binary"
        ? { file: getBinaryPath(), args }
        : { file: "node", args: [getNpmEntryPath(), ...args] };

    const stdinContent = this.stdinContent;
    this.stdinContent = undefined;

    const result = await execa(execArgs.file, execArgs.args, {
      cwd: this.projectDir ?? this.tempDir,
      env,
      reject: false,
      all: false,
      input: stdinContent ?? "",
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 1,
    };
  }

  /** Start a long-running CLI command and return a live handle */
  async runLive(...args: string[]): Promise<RunLiveHandle> {
    this.setupEnvOverrides();

    const env: Record<string, string | undefined> = {
      ...this.env,
      [BASE44_APP_ID_ENV_VAR]: this.env[BASE44_APP_ID_ENV_VAR],
      BASE44_API_URL: this.api.baseUrl,
      PATH: process.env.PATH ?? "",
    };

    this.api.apply();

    const execArgs =
      TEST_RUNNER === "binary"
        ? { file: getBinaryPath(), args }
        : { file: "node", args: [getNpmEntryPath(), ...args] };

    const child = execa(execArgs.file, execArgs.args, {
      cwd: this.projectDir ?? this.tempDir,
      env,
      reject: false,
      all: false,
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    let finished: boolean = false;
    let stoppedWithCode: number | undefined;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk.toString());
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString());
    });

    const childPromise = child.then((result) => {
      finished = true;
      return result;
    });

    const buildResult = (exitCode: number): CLIResult => ({
      stdout: stdout.join(""),
      stderr: stderr.join(""),
      exitCode,
    });

    const handle: RunLiveHandle = {
      stdout,
      stderr,

      async waitForOutput(pattern, timeoutMs = 5000) {
        const regex =
          typeof pattern === "string" ? new RegExp(pattern) : pattern;
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (regex.test(stdout.join(""))) return;
          if (finished) {
            throw new Error(
              `Process exited before output matched ${pattern}. stdout: ${stdout.join("")}`,
            );
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error(
          `Timed out waiting for output matching ${pattern} after ${timeoutMs}ms. stdout: ${stdout.join("")}`,
        );
      },

      async stop() {
        if (stoppedWithCode !== undefined) {
          return buildResult(stoppedWithCode);
        }

        if (!finished) {
          child.kill("SIGINT");
          await Promise.race([
            childPromise,
            new Promise((r) => setTimeout(r, 3000)),
          ]);
          if (!finished) {
            child.kill("SIGKILL");
          }
        }

        const result = await childPromise;
        const wasKilledByUs =
          result.signal === "SIGINT" || result.signal === "SIGKILL";
        stoppedWithCode = result.exitCode ?? (wasKilledByUs ? 0 : 1);
        return buildResult(stoppedWithCode);
      },
    };

    this.liveHandles.push(handle);
    return handle;
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
    for (const handle of this.liveHandles) {
      await handle.stop();
    }
    this.liveHandles = [];
    await this.api.stop();
    // Use maxRetries to handle Windows EBUSY: child processes (e.g. Deno)
    // release file handles asynchronously after exit.
    await rm(this.tempDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 300,
    });
  }
}
