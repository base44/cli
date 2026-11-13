import type { Command } from "commander";
import { createDevLogger } from "@/cli/dev/createDevLogger.js";
import { createJwtToken } from "@/cli/dev/dev-server/auth/tokens.js";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import { createRemoteFrontDoor } from "@/cli/dev/dev-server/remote-front-door.js";
import type { LoginGateOptions } from "@/cli/dev/dev-server/routes/login-gate.js";
import type { ServeRunner } from "@/cli/dev/dev-server/serve-runner.js";
import {
  createServeCommandRunner,
  type ServeCommandRunnerOptions,
} from "@/cli/dev/serve-command-runner.js";
import { stopRunnerOnProcessSignals } from "@/cli/dev/stop-runner-on-signals.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { readAuth } from "@/core/auth/config.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
import {
  getAppUserToken,
  getAppVisibility,
  getSiteUrl,
} from "@/core/project/api.js";
import { readProjectConfig } from "@/core/project/config.js";
import type { Visibility } from "@/core/project/schema.js";

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

const APP_SERVER_START_TIMEOUT_MS = 120_000;

function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * The app dev server picks its own port and announces it on startup, so the
 * front door learns where to forward from the line it prints.
 */
function createAppServerOrigin(): {
  waitForOrigin: () => Promise<string>;
  report: (origin: string) => void;
} {
  let report!: (origin: string) => void;
  const announced = new Promise<string>((resolve) => {
    report = resolve;
  });
  const timedOut = new Promise<never>((_, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "The app dev server did not print a local URL, so requests cannot be forwarded to it.",
          ),
        ),
      APP_SERVER_START_TIMEOUT_MS,
    );
    timer.unref();
  });
  return {
    waitForOrigin: () => Promise.race([announced, timedOut]),
    report,
  };
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

async function resolveConfiguredSite(app: LinkedApp): Promise<{
  site?: ConfiguredSite;
  visibility?: Visibility;
}> {
  const { project } = await readProjectConfig(app.projectRoot);
  const serveCommand = project.site?.serveCommand;
  return {
    site: serveCommand
      ? { serveCommand, projectRoot: project.root }
      : undefined,
    visibility: project.visibility,
  };
}

/**
 * A private or workspace app sits behind a login, which the CLI provides
 * locally. The config's `visibility` is what deploy applies, so it wins; the
 * server's setting decides otherwise, and an unreachable server means public.
 */
async function resolveLoginGate(
  app: LinkedApp,
  visibility: Visibility | undefined,
  gate: Pick<LoginGateOptions, "dataSource"> & {
    mintToken: (email: string) => Promise<string>;
  },
): Promise<LoginGateOptions | undefined> {
  const resolved =
    visibility ?? (await getAppVisibility(app.id).catch(() => "public"));
  if (resolved === "public") {
    return undefined;
  }
  const { email } = await readAuth();
  return {
    email,
    dataSource: gate.dataSource,
    mintToken: () => gate.mintToken(email),
  };
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

async function remoteDevAction(
  app: LinkedApp,
  options: DevOptions,
): Promise<RunCommandResult> {
  const { site, visibility } = await resolveConfiguredSite(app);
  if (!site) {
    throw new ConfigInvalidError(
      "base44 dev --remote serves the frontend against the production backend, but this project has no site.serveCommand in base44/config.jsonc.",
    );
  }

  const siteUrl = await getSiteUrl();
  const loginGate = await resolveLoginGate(app, visibility, {
    dataSource: `your live app's data (${siteUrl})`,
    mintToken: () => getAppUserToken(),
  });
  const appServerOrigin = createAppServerOrigin();
  const frontDoor = await createRemoteFrontDoor({
    port: options.port ? Number(options.port) : undefined,
    siteUrl,
    appServer: { appId: app.id, waitForOrigin: appServerOrigin.waitForOrigin },
    loginGate,
  });
  const frontDoorUrl = localServerUrl(frontDoor.port);

  const runner = createServeCommandRunner({
    ...site,
    appId: app.id,
    appBaseUrl: frontDoorUrl,
    onOrigin: appServerOrigin.report,
    ignorePort: frontDoor.port,
  });
  // The front door lives in this process, relayed sockets and all, so exiting
  // is its shutdown — on Ctrl-C as much as when the app dev server dies.
  const stopAndExit = () => void runner.stop().finally(() => process.exit(0));
  process.on("SIGINT", stopAndExit);
  process.on("SIGTERM", stopAndExit);
  runner.onExit((code) => process.exit(code ?? 1));
  runner.start();

  return {
    outroMessage: `Your app is available at ${theme.colors.links(frontDoorUrl)} — it runs on the data of ${theme.styles.bold(siteUrl)}, so every write hits your live app`,
  };
}

async function localDevAction(
  ctx: CLIContext,
  app: LinkedApp,
  options: DevOptions,
): Promise<RunCommandResult> {
  const { site, visibility } = await resolveConfiguredSite(app);
  const siteUrlPromise = getSiteUrl().catch(() => undefined);
  const loginGate = site
    ? await resolveLoginGate(app, visibility, {
        dataSource: "a local database where your account is an admin",
        mintToken: async (email) => createJwtToken(email),
      })
    : undefined;
  const appServerOrigin = createAppServerOrigin();

  const backend = await createDevServer({
    log: ctx.log,
    port: options.port ? Number(options.port) : undefined,
    denoWrapperPath: getDenoWrapperPath(),
    appServer: site
      ? { appId: app.id, waitForOrigin: appServerOrigin.waitForOrigin }
      : undefined,
    loginGate,
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
      onOrigin: appServerOrigin.report,
      ignorePort: backend.port,
    });
    startServeCommand(runner, { url: backendUrl, shutdown: backend.shutdown });
  }

  // One origin for the app and its backend, the way the platform serves it.
  const outroMessage = site
    ? `Your app is available at ${theme.colors.links(backendUrl)}`
    : `Dev server is available at ${theme.colors.links(backendUrl)}`;

  return { outroMessage };
}

async function devAction(
  ctx: CLIContext,
  options: DevOptions,
): Promise<RunCommandResult> {
  const app = requireLinkedProject(ctx);
  return options.remote
    ? remoteDevAction(app, options)
    : localDevAction(ctx, app, options);
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .option(
      "--remote",
      "Serve the app against your live app's data instead of a local backend",
    )
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
