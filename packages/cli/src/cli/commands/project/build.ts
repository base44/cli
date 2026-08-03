import type { Command } from "commander";
import { execa } from "execa";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigInvalidError, ConfigNotFoundError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";

async function buildAction(ctx: CLIContext): Promise<RunCommandResult> {
  const { app } = ctx;
  if (!app?.projectRoot) {
    throw new ConfigInvalidError(
      "base44 build requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }

  const { project } = await readProjectConfig(app.projectRoot);
  const buildCommand = project.site?.buildCommand;
  if (!buildCommand) {
    throw new ConfigNotFoundError("No site build command found.", {
      hints: [
        {
          message:
            'Add \'site.buildCommand\' to your config.jsonc (e.g., "site": { "buildCommand": "npm run build" })',
        },
      ],
    });
  }

  await ctx.runTask(
    "Building site...",
    () =>
      execa({
        cwd: project.root,
        shell: true,
        env: { VITE_BASE44_APP_ID: app.id },
      })`${buildCommand}`,
    {
      successMessage: "Site built successfully",
      errorMessage: "Build failed",
    },
  );

  return {
    outroMessage: `Site built with app id ${theme.styles.bold(app.id)}`,
  };
}

export function getBuildCommand(): Command {
  return new Base44Command("build")
    .description("Build the site with the Base44 app id injected")
    .action(buildAction);
}
