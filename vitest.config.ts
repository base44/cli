import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.spec.ts"],
    testTimeout: 30000,
    mockReset: true,
    silent: true, // Suppress stdout/stderr from tests (CLI output is very noisy)
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
