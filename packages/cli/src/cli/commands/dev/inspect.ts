import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { isPidAlive, readEnv } from "@/core/dev/registry.js";
import { ConfigInvalidError } from "@/core/errors.js";

async function devInspectAction(
  _ctx: CLIContext,
  name: string,
): Promise<RunCommandResult> {
  const env = await readEnv(name);
  if (!env) {
    throw new ConfigInvalidError(
      `No dev env named "${name}". List envs with: base44 dev ps`,
    );
  }
  const live = isPidAlive(env.pid);
  const resolved = {
    ...env,
    status: live ? env.status : env.status === "starting" ? "error" : "stopped",
    alive: live,
  };
  return { stdout: `${JSON.stringify(resolved, null, 2)}\n` };
}

export function getInspectCommand(): Command {
  return new Base44Command("inspect", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("Show full details (url, port, pid, logs) for a dev env")
    .argument("<name>", "Env name")
    .action(devInspectAction);
}
