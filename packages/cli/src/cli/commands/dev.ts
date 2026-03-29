import type { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { readProjectConfig } from "@/core/project/config.js";

interface DevOptions {
  port?: string;
}

async function devAction(
  { log }: CLIContext,
  options: DevOptions,
): Promise<RunCommandResult> {
  const port = options.port ? Number(options.port) : undefined;
  const { port: resolvedPort } = await createDevServer({
    log,
    port,
    denoWrapperPath: getDenoWrapperPath(),
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      return { functions, entities, project };
    },
  });

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(`http://localhost:${resolvedPort}`)}`,
  };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .action(devAction);
}
