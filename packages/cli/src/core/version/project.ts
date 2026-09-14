import { dirname, join, resolve } from "node:path";
import { PROJECT_SUBDIR } from "@/core/consts.js";
import { ConfigNotFoundError } from "@/core/errors.js";
import { readProjectSettings } from "@/core/project/index.js";
import type { ProjectWithPaths } from "@/core/project/types.js";

/**
 * What a Builder repo builds like when nobody wrote a CLI config for it. Both
 * come from the app template every Builder app is seeded from.
 */
const DEFAULT_BUILD_COMMAND = "npm run build";
const DEFAULT_OUTPUT_DIRECTORY = "dist";

export interface PublishTarget {
  root: string;
  /** Where `entitiesDir` and `agentsDir` are resolved from. */
  configDir: string;
  /** `undefined` when a config is present and declares none — `runSiteBuild`
   * reports that, as it always has. */
  buildCommand?: string;
  /** `null` for the same reason, resolved by {@link requireOutputDir} at the
   * point of collection — so a project missing both is told about its build
   * command first, which is the one it hits first. */
  outputDir: string | null;
  entitiesDir: string;
  agentsDir: string;
}

/**
 * Resolve where to build and what to publish, filling in what a Builder repo
 * does not carry.
 *
 * Builder repos have NO CLI project config, which is why the sandbox used to
 * overwrite `base44/config.jsonc` with a minimal one — destroying any
 * checked-in configuration, and for a full-stack app destroying its build
 * command. Nothing here writes a file.
 *
 * The defaults apply only when there is no config AT ALL. A config that is
 * present and omits a field said so deliberately, and answering that with a
 * guessed `npm run build` would silently change what `base44 build` does for
 * every project that already relies on the error.
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
 * The project's own settings, or `null` when it has none.
 *
 * Only a MISSING config is answered with `null`: a config that is present and
 * invalid still throws, because publishing past a broken one is how a typo
 * becomes a version built the wrong way.
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
