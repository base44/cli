import { openSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Command } from "commander";
import getPort, { portNumbers } from "get-port";
import {
  localServerUrl,
  startDevServerForProject,
  waitForHealth,
} from "@/cli/commands/dev/shared.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, theme } from "@/cli/utils/index.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import {
  type DevEnv,
  defaultEnvName,
  getEnvLogPath,
  isPidAlive,
  patchEnv,
  readEnv,
  writeEnv,
} from "@/core/dev/registry.js";
import { ConfigInvalidError } from "@/core/errors.js";

export interface DevRunOptions {
  port?: string;
  detach?: boolean;
  name?: string;
  json?: boolean;
}

function requireProject(ctx: CLIContext) {
  if (!ctx.app?.projectRoot) {
    throw new ConfigInvalidError(
      "base44 dev requires a linked local project. Run it from a project with base44/.app.jsonc.",
    );
  }
  return { projectRoot: ctx.app.projectRoot, appId: ctx.app.id };
}

/** The classic, agent-blocking foreground server. */
async function runForeground(
  ctx: CLIContext,
  options: DevRunOptions,
): Promise<RunCommandResult> {
  const { appId } = requireProject(ctx);
  const port = options.port ? Number(options.port) : undefined;
  const { port: resolvedPort, isServingFrontend } =
    await startDevServerForProject({ log: ctx.log, port, appId });

  const outroMessage = isServingFrontend
    ? "Open your app using the frontend dev server URL"
    : `Dev server is available at ${theme.colors.links(localServerUrl(resolvedPort))}`;
  return { outroMessage };
}

/**
 * Detached, Docker-style env: spawn the daemon in the background, record it in
 * the registry, wait until it's healthy, then print the URL + log path so an
 * agent can drive a feedback loop without staying attached to this process.
 */
async function runDetached(
  ctx: CLIContext,
  options: DevRunOptions,
): Promise<RunCommandResult> {
  const { projectRoot, appId } = requireProject(ctx);
  const name = options.name ?? defaultEnvName(projectRoot);

  const existing = await readEnv(name);
  if (existing && isPidAlive(existing.pid)) {
    throw new ConfigInvalidError(
      `Dev env "${name}" is already running at ${existing.url}. ` +
        `Stop it with: base44 dev stop ${name}`,
    );
  }

  const resolvedPort = options.port
    ? Number(options.port)
    : await getPort({ port: portNumbers(4400, 4500) });
  const url = localServerUrl(resolvedPort);
  const logPath = getEnvLogPath(name);
  await mkdir(dirname(logPath), { recursive: true });

  // Re-invoke this same CLI as a hidden daemon command, fully detached, with
  // stdout/stderr redirected to the env's log file.
  const logFd = openSync(logPath, "a");
  const isBinary = ctx.distribution === "binary";
  const preArgs = isBinary ? [] : [process.argv[1]];
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [
      ...preArgs,
      "dev",
      "__daemon",
      "--name",
      name,
      "--port",
      String(resolvedPort),
    ],
    {
      cwd: projectRoot,
      // Don't leak a stale app-id override into the daemon's project resolution.
      env: {
        ...process.env,
        [BASE44_APP_ID_ENV_VAR]: undefined,
      } as NodeJS.ProcessEnv,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    },
  );
  child.unref();

  const env: DevEnv = {
    name,
    appId,
    projectRoot,
    port: resolvedPort,
    url,
    pid: child.pid ?? -1,
    logPath,
    status: "starting",
    createdAt: new Date().toISOString(),
  };
  await writeEnv(env);

  const ready = await waitForHealth(url);
  await patchEnv(name, { status: ready ? "running" : "error" });

  if (options.json) {
    return {
      stdout: `${JSON.stringify({ ...env, status: ready ? "running" : "error" }, null, 2)}\n`,
    };
  }

  if (!ready) {
    return {
      outroMessage:
        `Dev env "${name}" did not become healthy in time. ` +
        `Check logs: base44 dev logs ${name}`,
    };
  }

  return {
    outroMessage:
      `Dev env "${name}" is running\n` +
      `  url:  ${theme.colors.links(url)}\n` +
      `  logs: base44 dev logs ${name}\n` +
      `  stop: base44 dev stop ${name}`,
  };
}

export async function devRunAction(
  ctx: CLIContext,
  options: DevRunOptions,
): Promise<RunCommandResult> {
  return options.detach
    ? runDetached(ctx, options)
    : runForeground(ctx, options);
}

/** Shared option set for both bare `dev` and `dev run`. */
export function addRunOptions(cmd: Base44Command): Base44Command {
  return cmd
    .option("-p, --port <number>", "Port for the local Base44 backend")
    .option("-d, --detach", "Run the env in the background (detached)")
    .option(
      "--name <name>",
      "Name for the background env (default: project dir)",
    )
    .option(
      "--json",
      "Output machine-readable JSON (with --detach)",
    ) as Base44Command;
}

export function getRunCommand(): Command {
  return addRunOptions(
    new Base44Command("run").description(
      "Start the dev env (use -d to run it in the background)",
    ),
  ).action(devRunAction);
}

/**
 * Hidden entry point that the detached `run -d` re-invokes. Runs the server in
 * the foreground of the daemon process and keeps the registry status in sync.
 */
export function getDaemonCommand(): Command {
  return new Base44Command("__daemon")
    .description("(internal) background dev env worker")
    .option("--name <name>", "env name")
    .option("--port <number>", "port")
    .action(
      async (ctx: CLIContext, options: { name: string; port: string }) => {
        const { appId } = requireProject(ctx);
        await startDevServerForProject({
          log: ctx.log,
          port: Number(options.port),
          appId,
        });
        await patchEnv(options.name, { status: "running", pid: process.pid });

        const markStopped = () => {
          void patchEnv(options.name, { status: "stopped" });
        };
        process.on("SIGTERM", markStopped);
        process.on("SIGINT", markStopped);
        // Resolves now; the listening server keeps the process alive.
        return {};
      },
    );
}
