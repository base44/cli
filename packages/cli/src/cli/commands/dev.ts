import { join } from "node:path";
import process from "node:process";
import type { Logger } from "@base44-cli/logger";
import type { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
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
  appId: string,
  port: number,
  log: Logger,
): Promise<void> {
  const envLocalPath = join(projectRoot, ".env.local");
  if (await pathExists(envLocalPath)) {
    return;
  }

  await writeFile(
    envLocalPath,
    `VITE_BASE44_APP_ID=${appId}\nVITE_BASE44_APP_BASE_URL=${localServerUrl(port)}\n`,
  );
  log.info("Created .env.local with app ID and dev server URL");
}

function validateDevOptions(command: Command): void {
  const { appId } = command.optsWithGlobals<AppIdOptions>();
  if (appId !== undefined) {
    command.error(
      `base44 dev cannot be used with --app-id or ${BASE44_APP_ID_ENV_VAR}.`,
    );
  }
}

async function devAction(
  ctx: CLIContext,
  options: DevOptions,
): Promise<RunCommandResult> {
  const { log, app } = ctx;
  if (!app?.projectRoot) {
    throw new ConfigInvalidError(
      "base44 dev requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }

  const port = options.port ? Number(options.port) : undefined;

  const { port: resolvedPort } = await createDevServer({
    log,
    port,
    cwd: process.cwd(),
    denoWrapperPath: getDenoWrapperPath(),
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      return { functions, entities, project };
    },
  });

  await writeEnvLocalIfMissing(app.projectRoot, app.id, resolvedPort, log);

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`,
  };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
