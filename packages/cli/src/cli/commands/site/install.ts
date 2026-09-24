import type { Command } from "commander";
import { execa } from "execa";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { ConfigNotFoundError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";

async function installAction({
  runTask,
}: CLIContext): Promise<RunCommandResult> {
  const { project } = await readProjectConfig();
  const installCommand = project.site?.installCommand;
  if (!installCommand) {
    throw new ConfigNotFoundError("No site install command found.", {
      hints: [
        {
          message:
            'Add a \'site\' block to your config.jsonc (e.g., "site": { "installCommand": "npm ci" }). Inside one, installCommand defaults to "npm install".',
        },
      ],
    });
  }

  await runTask(
    "Installing site dependencies...",
    () => execa({ cwd: project.root, shell: true })`${installCommand}`,
    {
      successMessage: "Dependencies installed",
      errorMessage: "Install failed",
    },
  );

  return {
    outroMessage: `Installed with ${theme.styles.bold(installCommand)}`,
  };
}

export function getSiteInstallCommand(): Command {
  // Local only: no app to resolve and no API to call, so a machine that has
  // never logged in (a build sandbox) can still install a project.
  return new Base44Command("install", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("Install the site's dependencies with its configured command")
    .action(installAction);
}
