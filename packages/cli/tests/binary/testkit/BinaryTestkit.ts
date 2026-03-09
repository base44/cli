import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { dir } from "tmp-promise";
import { BinaryAPIServer } from "./BinaryAPIServer.js";
import type { CLIResult } from "../../cli/testkit/CLIResultMatcher.js";
import { CLIResultMatcher } from "../../cli/testkit/CLIResultMatcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the CLI entry point (requires dist to be built first) */
const BIN_PATH = join(__dirname, "../../../bin/run.js");

interface TestOverrides {
  latestVersion?: string | null;
  appConfig?: { id: string; projectRoot: string };
}

/**
 * Testkit for end-to-end binary tests.
 *
 * Spawns the real `bin/run.js` process and points it at a local
 * Express mock server instead of the real Base44 API.
 *
 * **Prerequisite:** `bun run build` must be run before binary tests.
 *
 * @example
 * ```typescript
 * const kit = await BinaryTestkit.create();
 * await kit.api.start();
 * await kit.givenLoggedIn({ email: "test@example.com", name: "Test" });
 * await kit.givenProject(fixture("with-entities"));
 * kit.api.mockEntitiesPush({ created: ["User"], updated: [], deleted: [] });
 * kit.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
 * kit.api.mockConnectorsList({ integrations: [] });
 * const result = await kit.run("deploy", "-y");
 * kit.expect(result).toSucceed();
 * await kit.cleanup();
 * ```
 */
export class BinaryTestkit {
  private tempDir: string;
  private cleanupFn: () => Promise<void>;
  private projectDir?: string;
  // Default latestVersion to null to skip npm version check in tests
  private testOverrides: TestOverrides = { latestVersion: null };

  /** Mock HTTP server for Base44 API endpoints */
  readonly api: BinaryAPIServer;

  private constructor(
    tempDir: string,
    cleanupFn: () => Promise<void>,
    appId: string,
  ) {
    this.tempDir = tempDir;
    this.cleanupFn = cleanupFn;
    this.api = new BinaryAPIServer(appId);
  }

  /** Factory method - creates isolated test environment */
  static async create(appId = "test-app-id"): Promise<BinaryTestkit> {
    const { path, cleanup } = await dir({ unsafeCleanup: true });
    return new BinaryTestkit(path, cleanup, appId);
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
   * - Pass undefined to test the real npm version check (not recommended)
   */
  givenLatestVersion(version: string | null | undefined): void {
    this.testOverrides.latestVersion = version;
  }

  // ─── WHEN METHODS ─────────────────────────────────────────────

  /** Execute the real CLI binary with the given arguments */
  async run(...args: string[]): Promise<CLIResult> {
    if (this.projectDir) {
      this.testOverrides.appConfig = {
        id: this.api.appId,
        projectRoot: this.projectDir,
      };
    }

    const env: Record<string, string> = {
      HOME: this.tempDir,
      CI: "true",
      BASE44_DISABLE_TELEMETRY: "1",
      BASE44_API_URL: this.api.baseUrl,
      BASE44_CLI_TEST_OVERRIDES: JSON.stringify(this.testOverrides),
      // Forward PATH so node can be found
      PATH: process.env.PATH ?? "",
    };

    const result = await execa("node", [BIN_PATH, ...args], {
      env,
      cwd: this.projectDir ?? this.tempDir,
      // Don't throw on non-zero exit — let the test assert on exitCode
      reject: false,
      // Capture output as strings
      all: false,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode ?? 1,
    };
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
