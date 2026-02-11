import chalk from "chalk";
import { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { CLIContext } from "../types";

async function devAction(): Promise<RunCommandResult> {
  const { port } = await createDevServer();

  return {
    outroMessage: `Dev server is available at ${chalk.underline.blue(`http://localhost:${port}`)}`,
  };
}

export function getDevCommand(context: CLIContext): Command {
  return new Command("dev")
    .description("Start the development server")
    .action(async () => {
      await runCommand(devAction, { requireAuth: true }, context);
    });
}
