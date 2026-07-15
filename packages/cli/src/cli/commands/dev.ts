import type { Command } from "commander";
import { linkProjectInteractive } from "@/cli/commands/project/link.js";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { getSiteUrl } from "@/core/project/api.js";
import { readProjectConfig } from "@/core/project/config.js";
import type { AppContext } from "@/core/project/index.js";
import {
  appConfigExists,
  findProjectRoot,
  initAppContext,
} from "@/core/project/index.js";

interface DevOptions {
  port?: string;
}

function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Resolve the app context for `dev`. When a human runs `dev` in a project that
 * exists but isn't linked yet, start the interactive link flow inline instead
 * of surfacing the "run base44 link" error, which only helps non-interactive
 * (agent) callers. Non-interactive callers keep the original error + hint.
 */
async function resolveDevAppContext(ctx: CLIContext): Promise<AppContext> {
  const projectRoot = findProjectRoot();

  if (
    projectRoot &&
    !ctx.isNonInteractive &&
    !(await appConfigExists(projectRoot.root))
  ) {
    ctx.log.info(
      "This project isn't linked to a Base44 app yet — let's link it.",
    );
    return linkProjectInteractive(ctx);
  }

  return initAppContext();
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
  const { log } = ctx;
  const app = await resolveDevAppContext(ctx);
  ctx.app = app;
  ctx.errorReporter.setContext({ appId: app.id });

  if (!app.projectRoot) {
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
  // App context is resolved inside the action (`resolveDevAppContext`) so an
  // interactive run in an unlinked project can start the link flow instead of
  // failing the requireAppContext middleware before the action runs.
  return new Base44Command("dev", { requireAppContext: false })
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
