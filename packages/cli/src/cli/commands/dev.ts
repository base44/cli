import type { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/config.js";

interface DevOptions {
  port?: string;
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

  // Resolve the frontend command and project root here, at the command level,
  // so the dev server just runs whatever it's handed. The frontend starts when
  // the project configures a `site.serveCommand`; to opt out, remove it.
  const { project } = await readProjectConfig();
  const serveCommand = project.site?.serveCommand;

  // The app id is injected into the frontend so it targets the local backend.
  const appId = serveCommand ? app.id : undefined;

  const { port: resolvedPort } = await createDevServer({
    log,
    port,
    denoWrapperPath: getDenoWrapperPath(),
    serve:
      serveCommand && appId
        ? { command: serveCommand, cwd: project.root, appId }
        : undefined,
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      return { functions, entities, project };
    },
  });

  const outroMessage = serveCommand
    ? "Open your app at the URL printed by the frontend dev server (tagged [frontend] above)."
    : `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`;

  return { outroMessage };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
