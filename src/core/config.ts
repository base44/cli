declare global {
  // Set by the compiled binary entry point (src/cli/binary-entry.ts)
  // to override asset paths that don't work inside Bun-compiled binaries.
  var __BASE44_TEMPLATES_DIR: string | undefined;
  var __BASE44_DENO_WRAPPER_PATH: string | undefined;
}

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROJECT_SUBDIR,
  TYPES_FILENAME,
  TYPES_OUTPUT_SUBDIR,
} from "@/core/consts.js";
import {
  type TestOverrides,
  TestOverridesSchema,
} from "@/core/project/schema.js";

// After bundling, import.meta.url points to dist/cli/index.js
// Templates are copied to dist/templates/
const __dirname = dirname(fileURLToPath(import.meta.url));

function getBase44GlobalDir(): string {
  return join(homedir(), ".base44");
}

export function getAuthFilePath(): string {
  return join(getBase44GlobalDir(), "auth", "auth.json");
}

export function getTemplatesDir(): string {
  if (globalThis.__BASE44_TEMPLATES_DIR)
    return globalThis.__BASE44_TEMPLATES_DIR;
  return join(__dirname, "../templates");
}

export function getTemplatesIndexPath(): string {
  return join(getTemplatesDir(), "templates.json");
}

export function getAppConfigPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_SUBDIR, ".app.jsonc");
}

export function getTypesOutputPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_SUBDIR, TYPES_OUTPUT_SUBDIR, TYPES_FILENAME);
}

export function getBase44ApiUrl(): string {
  return process.env.BASE44_API_URL || "https://app.base44.com";
}

export function getTestOverrides(): TestOverrides | null {
  const raw = process.env.BASE44_CLI_TEST_OVERRIDES;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    const result = TestOverridesSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
