import type { Command } from "commander";
import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";
import { createServeCommandRunner } from "@/cli/dev/serve-command-runner.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { getSiteUrl } from "@/core/project/api.js";
import { readProjectConfig } from "@/core/project/config.js";

interface DevOptions {
  port?: string;
}

interface LinkedApp {
  id: string;
  projectRoot: string;
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

function requireLinkedProject({ app }: CLIContext): LinkedApp {
  if (!app?.projectRoot) {
    throw new ConfigInvalidError(
      "base44 dev requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }
  return { id: app.id, projectRoot: app.projectRoot };
}

async function createConfiguredServeRunner(
  app: LinkedApp,
  backendUrl: string,
): Promise<ServeRunner | undefined> {
  const { project } = await readProjectConfig(app.projectRoot);
  const serveCommand = project.site?.serveCommand;
  if (!serveCommand) {
    return undefined;
  }
  return createServeCommandRunner({
    serveCommand,
    projectRoot: project.root,
    appId: app.id,
    appBaseUrl: backendUrl,
  });
}

function startServeCommand(
  runner: ServeRunner,
  backend: { url: string; shutdown: () => Promise<void> },
): void {
  const stop = () => void runner.stop();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // If the frontend dies, tear the whole dev environment down.
  runner.onExit(() => {
    void backend.shutdown().finally(() => process.exit(1));
  });

  createDevLogger("backend", theme.styles.info).log(
    `Backend running on ${backend.url}`,
  );
  runner.start();
}

async function devAction(
  ctx: CLIContext,
  options: DevOptions,
): Promise<RunCommandResult> {
  const app = requireLinkedProject(ctx);
  const siteUrlPromise = getSiteUrl().catch(() => undefined);

  const backend = await createDevServer({
    log: ctx.log,
    port: options.port ? Number(options.port) : undefined,
    denoWrapperPath: getDenoWrapperPath(),
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      const siteUrl = await siteUrlPromise;
      return { functions, entities, project, siteUrl };
    },
  });
  const backendUrl = localServerUrl(backend.port);

  const runner = await createConfiguredServeRunner(app, backendUrl);
  if (runner) {
    startServeCommand(runner, { url: backendUrl, shutdown: backend.shutdown });
  }

  const outroMessage = runner
    ? "Open your app using the frontend dev server URL"
    : `Dev server is available at ${theme.colors.links(backendUrl)}`;

  return { outroMessage };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
