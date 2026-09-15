import { dirname, join, resolve } from "node:path";
import { PROJECT_SUBDIR } from "@/core/consts.js";
import { ConfigNotFoundError } from "@/core/errors.js";
import { readProjectSettings } from "@/core/project/index.js";
import type { ProjectWithPaths } from "@/core/project/types.js";

/** From the app template every Builder app is seeded from. */
const DEFAULT_BUILD_COMMAND = "npm run build";
const DEFAULT_OUTPUT_DIRECTORY = "dist";

interface PublishTarget {
  root: string;
  /** Where `entitiesDir` and `agentsDir` are resolved from. */
  configDir: string;
  /** `undefined` when a config is present and declares none; `runSiteBuild`
   * reports that, as it always has. */
  buildCommand?: string;
  /** `null` for the same reason. {@link requireOutputDir} raises at collection,
   * so a project missing both hears about its build command first. */
  outputDir: string | null;
  entitiesDir: string;
  agentsDir: string;
}

/**
 * Resolve where to build and what to publish, filling in what a Builder repo
 * does not carry — without writing a file. The sandbox used to overwrite
 * `base44/config.jsonc` with a minimal one, destroying checked-in configuration.
 *
 * Defaults apply only when there is no config at all: one that omits a field
 * said so deliberately, and still gets today's error.
 */
export async function resolvePublishTarget(
  projectRoot: string | undefined,
  overrides: { outputDir?: string } = {},
): Promise<PublishTarget> {
  const project = await readSettingsIfPresent(projectRoot);
  const root = project?.root ?? projectRoot ?? process.cwd();

  return {
    root,
    configDir: project
      ? dirname(project.configPath)
      : join(root, PROJECT_SUBDIR),
    buildCommand: project ? project.site?.buildCommand : DEFAULT_BUILD_COMMAND,
    outputDir: outputDirectory(project, root, overrides.outputDir),
    entitiesDir: project?.entitiesDir ?? "entities",
    agentsDir: project?.agentsDir ?? "agents",
  };
}

function outputDirectory(
  project: ProjectWithPaths | null,
  root: string,
  override: string | undefined,
): string | null {
  const configured =
    override ??
    (project ? project.site?.outputDirectory : DEFAULT_OUTPUT_DIRECTORY);
  return configured ? resolve(root, configured) : null;
}

/** The directory to collect a build from, or the error saying the project never
 * named one. */
export function requireOutputDir(target: PublishTarget): string {
  if (target.outputDir === null) {
    throw new ConfigNotFoundError("No site configuration found.", {
      hints: [
        {
          message:
            'Add \'site.outputDirectory\' to your config.jsonc (e.g., "site": { "outputDirectory": "dist" })',
        },
        { message: `Or pass --output-dir <dir>, relative to ${target.root}` },
      ],
    });
  }
  return target.outputDir;
}

/**
 * The project's settings, or `null` when it has none. A config that is present
 * and invalid still throws — publishing past a broken one is how a typo becomes
 * a version built the wrong way.
 */
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
