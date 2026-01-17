import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  clean: true,
  // Don't bundle @oclif/core - it needs to be external for oclif to work properly
  external: ["@oclif/core"],
  // Copy templates to dist/templates/ so they're accessible at runtime
  copy: [{ from: "templates", to: "dist/templates" }],
});
