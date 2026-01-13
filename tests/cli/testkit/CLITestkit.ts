import { dir } from "tmp-promise";
import { execa } from "execa";
import { resolve, join } from "path";
import { mkdir, writeFile, cp, readFile } from "fs/promises";
import { mockServer, type RouteHandler } from "./MockServer.js";
import { CLIResultMatcher, type CLIResult } from "./CLIResultMatcher.js";

export type { CLIResult };

export class CLITestkit {
  private tempDir: string;
  private cleanupFn: () => Promise<void>;
  private env: Record<string, string> = {};
  private projectDir?: string;

  private constructor(tempDir: string, cleanupFn: () => Promise<void>) {
    this.tempDir = tempDir;
    this.cleanupFn = cleanupFn;
    // Set HOME to temp dir for auth file isolation
    this.env = { HOME: tempDir };
  }

  /** Factory method - creates isolated test environment */
  static async create(): Promise<CLITestkit> {
    const { path, cleanup } = await dir({ unsafeCleanup: true });
    return new CLITestkit(path, cleanup);
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

  /** Add environment variable */
  givenEnv(key: string, value: string): void {
    this.env[key] = value;
  }

  /** Register a mock route handler (uses shared mock server) */
  givenRoute(method: string, path: string, handler: RouteHandler): void {
    mockServer.addRoute(method, path, handler);
  }

  // ─── WHEN METHODS ─────────────────────────────────────────────

  /** Execute CLI command */
  async run(...args: string[]): Promise<CLIResult> {
    const cliRoot = resolve(__dirname, "../../..");
    const cwd = this.projectDir ?? cliRoot;

    const result = await execa(
      "node",
      [join(cliRoot, "dist/cli/index.js"), ...args],
      {
        cwd,
        env: {
          ...process.env,
          ...this.env,
          // Always point to mock server
          BASE44_API_URL: mockServer.getUrl(),
        },
        reject: false,
      }
    );

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

  // ─── CLEANUP ──────────────────────────────────────────────────

  async cleanup(): Promise<void> {
    await this.cleanupFn();
  }
}
