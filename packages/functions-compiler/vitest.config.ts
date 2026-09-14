import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "base44:internal/runtime-context": fileURLToPath(
        new URL("./src/runtime-context.ts", import.meta.url),
      ),
      // Resolved by the Deno bundler at deploy; stub it for vitest.
      "npm:@base44/sdk@0.8.41": fileURLToPath(
        new URL("./test/base44-sdk-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.spec.ts"],
    // Dependency fetch (real registry) + esbuild compile are slow on cold runs.
    hookTimeout: 120_000,
    testTimeout: 120_000,
  },
});
