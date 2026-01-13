import { beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { resolve } from "path";
import { mockServer } from "./MockServer.js";
import { CLITestkit } from "./CLITestkit.js";

export { CLITestkit };
export type { CLIResult } from "./CLIResultMatcher.js";

const FIXTURES_DIR = resolve(__dirname, "../../fixtures");

/** Resolve a fixture path by name */
export function fixture(name: string): string {
  return resolve(FIXTURES_DIR, name);
}

/**
 * Sets up the CLI test environment for a describe block.
 * - Starts mock server once (shared across all tests)
 * - Creates fresh CLITestkit per test
 * - Cleans up routes and temp dirs after each test
 *
 * @example
 * import { setupCLITests } from "./testkit/index.js";
 *
 * describe("my command", () => {
 *   const { kit } = setupCLITests();
 *
 *   it("works", async () => {
 *     kit().givenRoute("GET", "/api/test", () => ({ body: { ok: true } }));
 *     const result = await kit().run("my-command");
 *     kit().expect(result).toSucceed();
 *   });
 * });
 */
export function setupCLITests(): { kit: () => CLITestkit } {
  let currentKit: CLITestkit | null = null;

  beforeAll(async () => {
    await mockServer.start();
  });

  beforeEach(async () => {
    currentKit = await CLITestkit.create();
  });

  afterEach(async () => {
    mockServer.resetRoutes();
    if (currentKit) {
      await currentKit.cleanup();
      currentKit = null;
    }
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  return {
    kit: () => {
      if (!currentKit) {
        throw new Error("CLITestkit not initialized. Make sure setupCLITests() is called inside describe()");
      }
      return currentKit;
    },
  };
}
