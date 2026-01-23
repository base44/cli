import { resolve } from "node:path";
import { beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import { setupServer } from "msw/node";
import { CLITestkit } from "./CLITestkit.js";

const FIXTURES_DIR = resolve(__dirname, "../../fixtures");

export const mswServer = setupServer();

/** Resolve a fixture path by name */
export function fixture(name: string): string {
  return resolve(FIXTURES_DIR, name);
}

/**
 * Sets up the CLI test environment for a describe block.
 * - Starts MSW server once (shared across all tests)
 * - Creates fresh CLITestkit per test
 * - Cleans up handlers and temp dirs after each test
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

  beforeAll(() => {
    mswServer.listen({ onUnhandledRequest: "bypass" });
  });

  beforeEach(async () => {
    currentKit = await CLITestkit.create();
  });

  afterEach(async () => {
    mswServer.resetHandlers();  // Clear handlers between tests
    if (currentKit) {
      await currentKit.cleanup();
      currentKit = null;
    }
  });

  afterAll(() => {
    mswServer.close();
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
