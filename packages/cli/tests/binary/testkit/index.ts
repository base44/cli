import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";
import type { CLIResult } from "../../cli/testkit/CLIResultMatcher.js";
import type { CLIResultMatcher } from "../../cli/testkit/CLIResultMatcher.js";
import { BinaryAPIServer } from "./BinaryAPIServer.js";
import { BinaryTestkit } from "./BinaryTestkit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, "../../fixtures");

/** Resolve a fixture path by name */
export function fixture(name: string): string {
  return resolve(FIXTURES_DIR, name);
}

/**
 * Test context returned by setupBinaryTests.
 * Mirrors the TestContext interface from the CLI testkit.
 */
export interface BinaryTestContext {
  /** Get the raw BinaryTestkit instance (rarely needed) */
  kit: BinaryTestkit;

  // ─── GIVEN METHODS ─────────────────────────────────────────

  /** Set up authenticated user state */
  givenLoggedIn: (user: { email: string; name: string }) => Promise<void>;

  /** Set up project directory by copying fixture to temp dir */
  givenProject: (fixturePath: string) => Promise<void>;

  /** Combined: login + project setup (most common pattern) */
  givenLoggedInWithProject: (
    fixturePath: string,
    user?: { email: string; name: string },
  ) => Promise<void>;

  givenLatestVersion: (version: string | null | undefined) => void;

  // ─── WHEN METHODS ──────────────────────────────────────────

  /** Execute the real CLI binary with the given arguments */
  run: (...args: string[]) => Promise<CLIResult>;

  // ─── THEN METHODS ──────────────────────────────────────────

  /** Create assertion helper for CLI result */
  expectResult: (result: CLIResult) => CLIResultMatcher;

  /** Read the auth file (for login tests) */
  readAuthFile: () => Promise<Record<string, unknown> | null>;

  /** Read a file from the project directory */
  readProjectFile: (relativePath: string) => Promise<string | null>;

  /** Check if a file exists in the project directory */
  fileExists: (relativePath: string) => Promise<boolean>;

  /** Get the temp directory path */
  getTempDir: () => string;

  // ─── API MOCKS ─────────────────────────────────────────────

  /** API mock helpers (real HTTP server) */
  api: BinaryTestkit["api"];
}

/**
 * Sets up the binary test environment for a describe block.
 *
 * Each test gets a fresh isolated environment:
 * - A new temp directory (used as HOME)
 * - A new Express mock server on a random port
 * - A fresh BinaryTestkit instance
 *
 * **Prerequisite:** Run `bun run build` before executing binary tests.
 * Tests are skipped automatically when the dist is not built.
 *
 * @example
 * ```typescript
 * const t = setupBinaryTests();
 *
 * it("deploys entities", async () => {
 *   await t.givenLoggedInWithProject(fixture("with-entities"));
 *   t.api.mockEntitiesPush({ created: ["User"], updated: [], deleted: [] });
 *   t.api.mockAgentsPush({ created: [], updated: [], deleted: [] });
 *   t.api.mockConnectorsList({ integrations: [] });
 *   const result = await t.run("deploy", "-y");
 *   t.expectResult(result).toSucceed();
 * });
 * ```
 */
export function setupBinaryTests(): BinaryTestContext {
  let currentKit: BinaryTestkit | null = null;

  const getKit = (): BinaryTestkit => {
    if (!currentKit) {
      throw new Error(
        "BinaryTestkit not initialized. Make sure setupBinaryTests() is called inside describe()",
      );
    }
    return currentKit;
  };

  beforeEach(async () => {
    currentKit = await BinaryTestkit.create();
    await currentKit.api.start();
  });

  afterEach(async () => {
    if (currentKit) {
      await currentKit.cleanup();
      currentKit = null;
    }
  });

  const defaultUser = { email: "test@example.com", name: "Test User" };

  return {
    get kit() {
      return getKit();
    },

    // Given methods
    givenLoggedIn: (user) => getKit().givenLoggedIn(user),
    givenProject: (fixturePath) => getKit().givenProject(fixturePath),
    givenLoggedInWithProject: async (fixturePath, user = defaultUser) => {
      await getKit().givenLoggedIn(user);
      await getKit().givenProject(fixturePath);
    },
    givenLatestVersion: (version) => getKit().givenLatestVersion(version),

    // When methods
    run: (...args) => getKit().run(...args),

    // Then methods
    expectResult: (result) => getKit().expect(result),
    readAuthFile: () => getKit().readAuthFile(),
    readProjectFile: (relativePath) => getKit().readProjectFile(relativePath),
    fileExists: (relativePath) => getKit().fileExists(relativePath),
    getTempDir: () => getKit().getTempDir(),

    // API mocks
    get api() {
      return getKit().api;
    },
  };
}

export { BinaryAPIServer } from "./BinaryAPIServer.js";
export { BinaryTestkit } from "./BinaryTestkit.js";
export type { CLIResult } from "../../cli/testkit/CLIResultMatcher.js";
export { CLIResultMatcher } from "../../cli/testkit/CLIResultMatcher.js";
