import type { Command } from "commander";
import { execa } from "execa";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import {
  DEFAULT_SITE,
  readProjectSettingsOrDefaults,
  runSiteCommandOrDefault,
  siteOrDefault,
} from "@/core/project/index.js";

async function installAction({
  runTask,
}: CLIContext): Promise<RunCommandResult> {
  // Config only: installing dependencies reads none of the project's resource
  // files, so an invalid one must not fail it.
  const project = await readProjectSettingsOrDefaults();
  const { installCommand } = siteOrDefault(project);
  let ran = installCommand;

  await runTask(
    "Installing site dependencies...",
    () =>
      runSiteCommandOrDefault(
        installCommand,
        DEFAULT_SITE.installCommand,
        (command) => {
          ran = command;
          return execa({ cwd: project.root, shell: true })`${command}`;
        },
      ),
    {
      successMessage: "Dependencies installed",
      errorMessage: "Install failed",
    },
  );

  return {
    outroMessage: `Installed with ${theme.styles.bold(ran)}`,
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
