import { join } from "node:path";
import type { Logger } from "@base44-cli/logger";
import type { Command } from "commander";
import { createDevServer } from "@/cli/dev/dev-server/main.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command, theme } from "@/cli/utils/index.js";
import { getDenoWrapperPath } from "@/core/assets.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/config.js";
import { writeFile } from "@/core/utils/fs.js";

interface DevOptions {
  port?: string;
  /** Commander sets this to false when `--no-serve` is passed; defaults to true. */
  serve?: boolean;
  writeEnv?: boolean;
}

function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Force-write `.env.local` with the app ID and dev server URL the frontend
 * needs. Only called when `--write-env` is passed; by default we inject these
 * values into the spawned frontend process instead of touching the filesystem.
 */
async function writeEnvLocal(
  projectRoot: string,
  appId: string,
  port: number,
  log: Logger,
): Promise<void> {
  const envLocalPath = join(projectRoot, ".env.local");
  await writeFile(
    envLocalPath,
    `VITE_BASE44_APP_ID=${appId}\nVITE_BASE44_APP_BASE_URL=${localServerUrl(port)}\n`,
  );
  log.info("Wrote .env.local with app ID and dev server URL");
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
  const serveEnabled = options.serve !== false;

  // The app id is needed to inject env into the frontend and/or to write
  // `.env.local`. Resolve it up front when either path is active.
  const appId = serveEnabled || options.writeEnv ? app.id : undefined;

  const { port: resolvedPort } = await createDevServer({
    log,
    port,
    denoWrapperPath: getDenoWrapperPath(),
    serve: serveEnabled && appId ? { appId } : undefined,
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      return { functions, entities, project };
    },
  });

  if (options.writeEnv && appId) {
    await writeEnvLocal(app.projectRoot, appId, resolvedPort, log);
  }

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`,
  };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .option("--no-serve", "Do not start the frontend dev server (serveCommand)")
    .option("--write-env", "Write the app ID and dev server URL to .env.local")
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
