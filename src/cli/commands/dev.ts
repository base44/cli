import { dirname, join } from "node:path";
import { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, theme } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { readProjectConfig } from "@/core/project/config.js";
import { functionResource } from "@/core/resources/function/resource.js";

interface DevOptions {
  port?: string;
}

async function devAction(options: DevOptions): Promise<RunCommandResult> {
  const port = options.port ? Number(options.port) : undefined;
  const { port: resolvedPort } = await createDevServer({
    port,
    loadResources: async () => {
      const { project } = await readProjectConfig();
      const configDir = dirname(project.configPath);
      const functions = await functionResource.readAll(
        join(configDir, project.functionsDir),
      );
      return { functions };
    },
  });

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
        context,
      );
    });
}
