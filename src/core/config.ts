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
// Templates live under dist/assets/templates/
const __dirname = dirname(fileURLToPath(import.meta.url));

function getBase44GlobalDir(): string {
  return join(homedir(), ".base44");
}

export function getAuthFilePath(): string {
  return join(getBase44GlobalDir(), "auth", "auth.json");
}

export function getTemplatesDir(assetsDir?: string): string {
  if (assetsDir) return join(assetsDir, "templates");
  return join(__dirname, "../assets/templates");
}

export function getTemplatesIndexPath(assetsDir?: string): string {
  return join(getTemplatesDir(assetsDir), "templates.json");
}

export function getDenoWrapperPath(assetsDir?: string): string {
  if (assetsDir) return join(assetsDir, "deno-runtime", "main.js");
  return join(__dirname, "../assets/deno-runtime/main.js");
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
