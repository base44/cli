import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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

interface StoredTarget {
  apiUrl?: string;
  ffOverride?: string;
}

export function getTargetFilePath(): string {
  return join(getBase44GlobalDir(), "target.json");
}

/** The persisted non-default target set by `base44 target` — a staging or
 * preview host every command should hit instead of production. Synchronous:
 * `getBase44ApiUrl` runs at module evaluation, before any async context. */
export function readStoredTarget(): StoredTarget {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(getTargetFilePath(), "utf8"),
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const target = parsed as Record<string, unknown>;
      return {
        apiUrl: typeof target.apiUrl === "string" ? target.apiUrl : undefined,
        ffOverride:
          typeof target.ffOverride === "string" ? target.ffOverride : undefined,
      };
    }
  } catch {
    // No stored target — production defaults apply.
  }
  return {};
}

export function writeStoredTarget(target: StoredTarget): string {
  const path = getTargetFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(target, null, 2)}\n`);
  return path;
}

export function clearStoredTarget(): void {
  try {
    unlinkSync(getTargetFilePath());
  } catch {
    // Already absent.
  }
}

export function getBase44ApiUrl(): string {
  return (
    process.env.BASE44_API_URL ||
    readStoredTarget().apiUrl ||
    "https://app.base44.com"
  );
}

export function getFfOverride(): string | undefined {
  return process.env.BASE44_FF_OVERRIDE || readStoredTarget().ffOverride;
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
