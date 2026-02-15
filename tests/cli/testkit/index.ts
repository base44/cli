import { resolve } from "node:path";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import type { CLIResult, CLIResultMatcher } from "./CLIResultMatcher.js";
import { CLITestkit } from "./CLITestkit.js";

const FIXTURES_DIR = resolve(__dirname, "../../fixtures");

export const mswServer = setupServer();

/** Resolve a fixture path by name */
export function fixture(name: string): string {
  return resolve(FIXTURES_DIR, name);
}

/**
 * Test context returned by setupCLITests.
 * Provides a clean API for CLI integration tests.
 */
export interface TestContext {
  /** Get the raw CLITestkit instance (rarely needed) */
  kit: CLITestkit;

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

  /** Execute CLI command */
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

  /** API mock helpers */
  api: CLITestkit["api"];
}

/**
 * Sets up the CLI test environment for a describe block.
 *
 * @example
 * ```typescript
 * const t = setupCLITests();
 *
 * it("works", async () => {
 *   await t.givenLoggedInWithProject(fixture("with-entities"));
 *   t.api.mockEntitiesPush({ created: ["User"] });
 *   const result = await t.run("entities", "push");
 *   t.expectResult(result).toSucceed();
 * });
 * ```
 */
export function setupCLITests(): TestContext {
  let currentKit: CLITestkit | null = null;

  const getKit = (): CLITestkit => {
    if (!currentKit) {
      throw new Error(
        "CLITestkit not initialized. Make sure setupCLITests() is called inside describe()",
      );
    }
    return currentKit;
  };

  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: "bypass" });
  });

  beforeEach(async () => {
    currentKit = await CLITestkit.create();
  });

  afterEach(async () => {
    mswServer.resetHandlers();
    if (currentKit) {
      await currentKit.cleanup();
      currentKit = null;
    }
  });

  afterAll(() => {
    mswServer.close();
  });

  // Default user for givenLoggedInWithProject
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

export { Base44APIMock } from "./Base44APIMock.js";
export type { CLIResult } from "./CLIResultMatcher.js";
export { CLIResultMatcher } from "./CLIResultMatcher.js";
// Re-export types and classes that tests might need
export { CLITestkit } from "./CLITestkit.js";
