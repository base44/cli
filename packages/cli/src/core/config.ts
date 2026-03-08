import { homedir } from "node:os";
import { join } from "node:path";
import {
  PROJECT_SUBDIR,
  TYPES_FILENAME,
  TYPES_OUTPUT_SUBDIR,
} from "@/core/consts.js";
import {
  type TestOverrides,
  TestOverridesSchema,
} from "@/core/project/schema.js";

function getBase44GlobalDir(): string {
  return join(homedir(), ".base44");
}

export function getAuthFilePath(): string {
  return join(getBase44GlobalDir(), "auth", "auth.json");
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
