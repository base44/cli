import type { Command } from "commander";
import { getDevResetCommand } from "@/cli/commands/dev/reset.js";
import { getDevSeedCommand } from "@/cli/commands/dev/seed.js";
import { getDevStatusCommand } from "@/cli/commands/dev/status.js";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { getSiteUrl } from "@/core/project/api.js";
import { readProjectConfig } from "@/core/project/config.js";

interface DevOptions {
  port?: string;
  fresh?: boolean;
}

function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
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
  const appId = app.id;
  const siteUrlPromise = getSiteUrl().catch(() => undefined);

  const { port: resolvedPort, isServingFrontend } = await createDevServer({
    log,
    port,
    appId,
    state: { projectRoot: app.projectRoot, fresh: options.fresh === true },
    denoWrapperPath: getDenoWrapperPath(),
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      const siteUrl = await siteUrlPromise;
      return { functions, entities, project, siteUrl };
    },
  });

  const outroMessage = isServingFrontend
    ? "Open your app using the frontend dev server URL"
    : `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`;

  return { outroMessage };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .option("--fresh", "Delete local data before starting")
    .hook("preAction", (thisCommand, actionCommand) => {
      // The hook also fires for subcommands (e.g. `dev status`); the
      // --app-id restriction only applies to the default (server) action.
      if (thisCommand === actionCommand) {
        validateDevOptions(thisCommand);
      }
    })
    .action(devAction)
    .addCommand(getDevStatusCommand())
    .addCommand(getDevSeedCommand())
    .addCommand(getDevResetCommand());
}
