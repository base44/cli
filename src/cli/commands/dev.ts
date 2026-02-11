import { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main";
import { runCommand, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { CLIContext } from "../types.js";

async function devAction(): Promise<RunCommandResult> {
  const { port } = await createDevServer();

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(`http://localhost:${port}`)}`,
  };
}

export function getDevCommand(context: CLIContext): Command {
  return new Command("dev")
    .description("Start the development server")
    .action(async () => {
      await runCommand(devAction, { requireAuth: true }, context);
    });
}
