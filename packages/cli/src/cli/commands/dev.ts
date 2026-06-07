import { join } from "node:path";
import process from "node:process";
import type { Logger } from "@base44-cli/logger";
import type { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { initAppConfig } from "@/core/project/app-config.js";
import { readProjectConfig } from "@/core/project/config.js";
import { pathExists, writeFile } from "@/core/utils/fs.js";

interface DevOptions {
  port?: string;
}

function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * On first run there is no `.env.local`, so the `@base44/vite-plugin` in the
 * frontend has no app ID and falls back to the production backend instead of
 * this dev server. Write the file (matching the plugin's expected variable
 * names) unless the user already maintains one.
 */
async function writeEnvLocalIfMissing(
  projectRoot: string,
  port: number,
  log: Logger,
): Promise<void> {
  const envLocalPath = join(projectRoot, ".env.local");
  if (await pathExists(envLocalPath)) {
    return;
  }

  const { id: appId } = await initAppConfig();
  await writeFile(
    envLocalPath,
    `VITE_BASE44_APP_ID=${appId}\nVITE_BASE44_APP_BASE_URL=${localServerUrl(port)}\n`,
  );
  log.info("Created .env.local with app ID and dev server URL");
}

async function devAction(
  { log }: CLIContext,
  options: DevOptions,
): Promise<RunCommandResult> {
  const port = options.port ? Number(options.port) : undefined;
  let projectRoot: string | undefined;

  const { port: resolvedPort } = await createDevServer({
    log,
    port,
    cwd: process.cwd(),
    denoWrapperPath: getDenoWrapperPath(),
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      projectRoot = project.root;
      return { functions, entities, project };
    },
  });

  if (projectRoot) {
    await writeEnvLocalIfMissing(projectRoot, resolvedPort, log);
  }

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`,
  };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .action(devAction);
}
