import { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main";
import { runCommand, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import type { CLIContext } from "../types.js";

interface DevOptions {
  port?: string;
}

async function devAction(options: DevOptions): Promise<RunCommandResult> {
  const port = options.port ? Number(options.port) : undefined;
  const { port: resolvedPort } = await createDevServer({ port });

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(`http://localhost:${resolvedPort}`)}`,
  };
}

export function getDevCommand(context: CLIContext): Command {
  return new Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .action(async (options: DevOptions) => {
      await runCommand(
        () => devAction(options),
        { requireAuth: true },
        context
      );
    });
}
