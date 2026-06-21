import { Command } from "commander";
import type { AppIdOptions } from "@/cli/utils/index.js";
import { BASE44_APP_ID_ENV_VAR } from "@/core/consts.js";
import { getInspectCommand } from "./inspect.js";
import { getLogsCommand } from "./logs.js";
import { getPsCommand } from "./ps.js";
import { getDaemonCommand, getRunCommand } from "./run.js";
import { getStopCommand } from "./stop.js";
import { getTokenCommand } from "./token.js";

function validateDevOptions(command: Command): void {
  const { appId } = command.optsWithGlobals<AppIdOptions>();
  if (appId !== undefined) {
    command.error(
      `base44 dev cannot be used with --app-id or ${BASE44_APP_ID_ENV_VAR}.`,
    );
  }
}

/**
 * `dev` is a Docker-style env manager. Bare `base44 dev` still runs the server
 * in the foreground (it's the default subcommand, backwards compatible); the
 * other subcommands add background envs that survive the calling agent and can
 * be listed/tailed/stopped:
 *
 *   base44 dev run -d          # start a background env
 *   base44 dev ps              # list envs
 *   base44 dev logs <name>     # read an env's logs
 *   base44 dev inspect <name>  # url / port / pid / log path
 *   base44 dev token           # mint an SDK auth token
 *   base44 dev stop <name>     # stop an env
 *
 * Options are declared only on the leaf `run` command (not the `dev` parent):
 * Commander binds an option shared by parent and child to the parent, which
 * would silently strip `-d`/`--port`/`--name` from the subcommand. Keeping them
 * on `run` only (default subcommand) avoids that.
 */
export function getDevCommand(): Command {
  const dev = new Command("dev")
    .description("Start and manage local dev envs")
    .hook("preAction", validateDevOptions);

  dev.addCommand(getRunCommand(), { isDefault: true });
  dev.addCommand(getPsCommand());
  dev.addCommand(getLogsCommand());
  dev.addCommand(getInspectCommand());
  dev.addCommand(getStopCommand());
  dev.addCommand(getTokenCommand());
  dev.addCommand(getDaemonCommand(), { hidden: true });

  return dev;
}
