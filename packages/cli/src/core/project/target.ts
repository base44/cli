import { dirname, join, resolve } from "node:path";
import { PROJECT_SUBDIR } from "@/core/consts.js";
import { ConfigNotFoundError } from "@/core/errors.js";
import { DEFAULT_SITE, siteOrDefault } from "@/core/project/fallback.js";
import { readProjectSettings } from "@/core/project/index.js";
import type { ProjectWithPaths } from "@/core/project/types.js";

/** A project's resolved layout: where its build runs, and what it leaves behind. */
export interface BuildTarget {
  root: string;
  /** Where `entitiesDir`, `agentsDir` and `functionsDir` are resolved from. */
  configDir: string;
  buildCommand: string;
  outputDir: string;
  entitiesDir: string;
  agentsDir: string;
  functionsDir: string;
}

/**
 * Where to build, and what to collect afterwards — filling in what a Builder
 * repo does not carry, without writing a file. The sandbox used to overwrite
 * `base44/config.jsonc` with a minimal one, destroying checked-in configuration.
 *
 * Here and not under `version/`: nothing it resolves is about a version. `build`
 * needs the identical answer and is not a publish command, so a module that made
 * it import the versions lane to ask would have the dependency backwards.
 *
 * Whatever the config lacks — the file, its site block, or a field in it — comes
 * from the template defaults.
 */
export async function resolveBuildTarget(
  projectRoot: string | undefined,
  overrides: { outputDir?: string } = {},
): Promise<BuildTarget> {
  const project = await readSettingsIfPresent(projectRoot);
  const root = project?.root ?? projectRoot ?? process.cwd();
  const site = project ? siteOrDefault(project) : DEFAULT_SITE;

  return {
    root,
    configDir: project
      ? dirname(project.configPath)
      : join(root, PROJECT_SUBDIR),
    buildCommand: site.buildCommand,
    outputDir: resolve(
      root,
      overrides.outputDir ??
        site.outputDirectory ??
        DEFAULT_SITE.outputDirectory,
    ),
    entitiesDir: project?.entitiesDir ?? "entities",
    agentsDir: project?.agentsDir ?? "agents",
    functionsDir: project?.functionsDir ?? "functions",
  };
}

/** The project's settings, or `null` outside any project. */
async function readSettingsIfPresent(
  projectRoot?: string,
): Promise<ProjectWithPaths | null> {
  try {
    return await readProjectSettings(projectRoot);
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      return null;
    }
    throw error;
  }
}
