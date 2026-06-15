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
import { pathExists, readTextFile, writeFile } from "@/core/utils/fs.js";

interface DevOptions {
  port?: string;
  serve?: boolean;
  writeEnv?: boolean;
}

const ENV_HEADER = "# Edited by the base44 dev process";
const MANAGED_ENV_KEYS = ["VITE_BASE44_APP_ID", "VITE_BASE44_APP_BASE_URL"];

function localServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Write the app ID and dev server URL the frontend needs into `.env.local`.
 * Only called when `--write-env` is passed; by default we inject these values
 * into the spawned frontend process instead of touching the filesystem.
 *
 * Any existing assignments of the keys we manage are commented out rather than
 * deleted, so a user's own values (e.g. a remote `VITE_BASE44_APP_BASE_URL`)
 * are preserved and easy to restore.
 */
async function writeEnvLocal(
  projectRoot: string,
  appId: string,
  port: number,
  log: Logger,
): Promise<void> {
  const envLocalPath = join(projectRoot, ".env.local");
  const managed = [
    `VITE_BASE44_APP_ID=${appId}`,
    `VITE_BASE44_APP_BASE_URL=${localServerUrl(port)}`,
  ];

  let preserved = "";
  if (await pathExists(envLocalPath)) {
    const existing = await readTextFile(envLocalPath);
    preserved = existing
      .split("\n")
      .map((line) => {
        const key = line.match(/^\s*(\w+)\s*=/)?.[1];
        return key && MANAGED_ENV_KEYS.includes(key) ? `# ${line}` : line;
      })
      .join("\n")
      .trimEnd();
  }

  const block = `${ENV_HEADER}\n${managed.join("\n")}\n`;
  await writeFile(envLocalPath, preserved ? `${preserved}\n\n${block}` : block);
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

  // Resolve the frontend command and project root here, at the command level,
  // so the dev server just runs whatever it's handed.
  const { project } = await readProjectConfig();
  const serveCommand = project.site?.serveCommand;

  // The app id is needed to inject env into the frontend and/or to write
  // `.env.local`. Resolve it up front when either path is active.
  const appId = serveEnabled || options.writeEnv ? app.id : undefined;

  const { port: resolvedPort } = await createDevServer({
    log,
    port,
    denoWrapperPath: getDenoWrapperPath(),
    serve:
      serveEnabled && serveCommand && appId
        ? { command: serveCommand, cwd: project.root, appId }
        : undefined,
    loadResources: async () => {
      const { functions, entities, project } = await readProjectConfig();
      return { functions, entities, project };
    },
  });

  if (options.writeEnv && appId) {
    await writeEnvLocal(project.root, appId, resolvedPort, log);
  }

  return {
    outroMessage: `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`,
  };
}

export function getDevCommand(): Command {
  return new Base44Command("dev")
    .description("Start the development server")
    .option("-p, --port <number>", "Port for the development server")
    .option("--no-serve", "Do not start the frontend dev server")
    .option("--write-env", "Write the app ID and dev server URL to .env.local")
    .hook("preAction", validateDevOptions)
    .action(devAction);
}
