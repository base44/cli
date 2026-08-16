import type { Command } from "commander";
import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";
import {
  createServeCommandRunner,
  type ServeCommandRunnerOptions,
} from "@/cli/dev/serve-command-runner.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { getSiteUrl } from "@/core/project/api.js";
import { readProjectConfig } from "@/core/project/config.js";

interface DevOptions {
  port?: string;
  remote?: boolean;
}

interface LinkedApp {
  id: string;
  projectRoot: string;
}

type ConfiguredSite = Pick<
  ServeCommandRunnerOptions,
  "serveCommand" | "projectRoot"
>;

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
  const { port, remote } = command.opts<DevOptions>();
  if (remote && port !== undefined) {
    command.error(
      "--port applies to the local backend, which --remote does not start.",
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

async function resolveConfiguredSite(
  app: LinkedApp,
): Promise<ConfiguredSite | undefined> {
  const { project } = await readProjectConfig(app.projectRoot);
  const serveCommand = project.site?.serveCommand;
  return serveCommand ? { serveCommand, projectRoot: project.root } : undefined;
}

function stopRunnerOnProcessSignals(runner: ServeRunner): void {
  const stop = () => void runner.stop();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function startServeCommand(
  runner: ServeRunner,
  backend: { url: string; shutdown: () => Promise<void> },
): void {
  stopRunnerOnProcessSignals(runner);

  // If the frontend dies, tear the whole dev environment down.
  runner.onExit(() => {
    void backend.shutdown().finally(() => process.exit(1));
  });

  createDevLogger("backend", theme.styles.info).log(
    `Backend running on ${backend.url}`,
  );
  runner.start();
}

async function remoteDevAction(app: LinkedApp): Promise<RunCommandResult> {
  const site = await resolveConfiguredSite(app);
  if (!site) {
    throw new ConfigInvalidError(
      "base44 dev --remote serves the frontend against the production backend, but this project has no site.serveCommand in base44/config.jsonc.",
    );
  }

  const appBaseUrl = await getSiteUrl();
  const runner = createServeCommandRunner({
    ...site,
    appId: app.id,
    appBaseUrl,
  });
  stopRunnerOnProcessSignals(runner);
  runner.onExit((code) => process.exit(code ?? 1));
  runner.start();

  return {
    outroMessage: `Frontend dev server targets ${theme.styles.bold(appBaseUrl)} — every write hits your live app`,
  };
}

async function localDevAction(
  ctx: CLIContext,
  app: LinkedApp,
  options: DevOptions,
): Promise<RunCommandResult> {
  const site = await resolveConfiguredSite(app);
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

  if (site) {
    const runner = createServeCommandRunner({
      ...site,
      appId: app.id,
      appBaseUrl: backendUrl,
    });
    startServeCommand(runner, { url: backendUrl, shutdown: backend.shutdown });
  }

  const outroMessage = site
    ? "Open your app using the frontend dev server URL"
    : `Dev server is available at ${theme.colors.links(backendUrl)}`;

  return { outroMessage };
}

async function devAction(
  ctx: CLIContext,
  options: DevOptions,
): Promise<RunCommandResult> {
  const app = requireLinkedProject(ctx);
  return options.remote
    ? remoteDevAction(app)
    : localDevAction(ctx, app, options);
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .option(
      "--remote",
      "Serve the frontend against the production backend instead of a local one",
    )
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
