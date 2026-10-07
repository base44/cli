import type { z } from "zod";
import {
  type ProjectConfig,
  ProjectConfigSchema,
} from "@/core/project/schema.js";
import type { ProjectWithPaths } from "@/core/project/types.js";

/** What every Base44 template ships, and what a missing or broken config falls back to. */
export const DEFAULT_SITE = Object.freeze({
  installCommand: "npm install",
  buildCommand: "npm run build",
  serveCommand: "npm run dev",
  outputDirectory: "./dist",
});

const PLACEHOLDER_APP_NAME = "base44-app";

/**
 * Fields that describe the app or its site, not where its resources live. Not
 * `visibility`: dropping a typo'd "Private" would deploy and leave the app public.
 */
const DEFAULTABLE_FIELDS = new Set(["name", "description", "site"]);

type SiteConfig = NonNullable<ProjectConfig["site"]>;

let warningHandler: (message: string) => void = () => {};
const warned = new Set<string>();

/** Core has no UI: the CLI layer registers where config fallbacks are reported. */
export function setConfigWarningHandler(handler: (message: string) => void) {
  warningHandler = handler;
}

export function warnConfigFallback(message: string): void {
  // Several readers may load the same config in one command; say it once.
  if (warned.has(message)) {
    return;
  }
  warned.add(message);
  warningHandler(message);
}

export function defaultProjectConfig(): ProjectConfig {
  return ProjectConfigSchema.parse({
    name: PLACEHOLDER_APP_NAME,
    site: DEFAULT_SITE,
  });
}

export function onlyDefaultableFieldsInvalid(error: z.ZodError): boolean {
  return error.issues.every(
    (issue) =>
      issue.path.length > 0 && DEFAULTABLE_FIELDS.has(String(issue.path[0])),
  );
}

/**
 * Keeps every field of `raw` the schema accepts and replaces the rest with its
 * default, so one bad value does not discard a project's custom build command.
 */
export function salvageProjectConfig(
  raw: unknown,
  error: z.ZodError,
): ProjectConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return defaultProjectConfig();
  }

  const fixed: Record<string, unknown> = { ...raw };
  for (const issue of error.issues) {
    if (issue.path.length === 0) {
      return defaultProjectConfig();
    }
    const [key, field] = issue.path.map(String) as [string, string?];
    if (key === "name") {
      fixed.name = PLACEHOLDER_APP_NAME;
    } else if (key === "site") {
      fixed.site =
        field !== undefined && isPlainObject(fixed.site)
          ? withoutKey(fixed.site, field)
          : DEFAULT_SITE;
    } else {
      fixed[key] = undefined;
    }
  }

  const result = ProjectConfigSchema.safeParse(fixed);
  return result.success ? result.data : defaultProjectConfig();
}

/**
 * The site block, or the template's when the config has none. Only for commands
 * that exist to install, build, serve or deploy a site: `base44 dev` and
 * `base44 deploy` read an absent block as "no frontend here".
 */
export function siteOrDefault(project: ProjectWithPaths): SiteConfig {
  if (project.site) {
    return project.site;
  }
  warnConfigFallback(
    `${project.configPath} has no 'site' block; using the default site commands.`,
  );
  return DEFAULT_SITE;
}

/**
 * A POSIX shell's exit status when the program it was told to run does not
 * exist. `cmd /c` exits 1 for that, which nothing distinguishes from a failure.
 */
const COMMAND_NOT_FOUND_EXIT_CODE = 127;

/**
 * Runs a site command from the config, and `fallback` when its program is not
 * installed (a pnpm config where only npm exists). Anything else that fails,
 * including the fallback, fails as it would have.
 */
export async function runSiteCommandOrDefault<T>(
  command: string,
  fallback: string,
  run: (command: string) => Promise<T>,
): Promise<T> {
  try {
    return await run(command);
  } catch (error) {
    if (command === fallback || !isCommandNotFound(error)) {
      throw error;
    }
    warnSiteCommandFallback(command, fallback);
    return run(fallback);
  }
}

export function warnSiteCommandFallback(
  command: string,
  fallback: string,
): void {
  warnConfigFallback(
    `'${command}' could not start because its program is not installed; running '${fallback}' instead.`,
  );
}

export function isCommandNotFoundExit(code: unknown): boolean {
  return code === COMMAND_NOT_FOUND_EXIT_CODE && process.platform !== "win32";
}

function isCommandNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "exitCode" in error &&
    isCommandNotFoundExit(error.exitCode)
  );
}

function withoutKey(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
