import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { readEnv } from "@/core/dev/registry.js";
import { ConfigInvalidError } from "@/core/errors.js";
import { pathExists, readTextFile } from "@/core/utils/fs.js";

async function devLogsAction(
  _ctx: CLIContext,
  name: string,
  options: { tail?: string },
): Promise<RunCommandResult> {
  const env = await readEnv(name);
  if (!env) {
    throw new ConfigInvalidError(
      `No dev env named "${name}". List envs with: base44 dev ps`,
    );
  }
  if (!(await pathExists(env.logPath))) {
    return { stdout: "" };
  }
  const contents = await readTextFile(env.logPath);
  const tail = options.tail ? Number(options.tail) : undefined;
  if (tail && Number.isFinite(tail)) {
    const lines = contents.split("\n");
    return { stdout: `${lines.slice(-tail).join("\n")}` };
  }
  return { stdout: contents };
}

export function getLogsCommand(): Command {
  return new Base44Command("logs", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("Print the logs for a background dev env")
    .argument("<name>", "Env name")
    .option("-n, --tail <lines>", "Show only the last N lines")
    .action(devLogsAction);
}
