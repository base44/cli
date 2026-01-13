import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.spec.ts"],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      "@core": resolve(__dirname, "./src/core"),
    },
  },
});
