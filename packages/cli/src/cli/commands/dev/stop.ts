import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import {
  isPidAlive,
  patchEnv,
  readEnv,
  removeEnv,
} from "@/core/dev/registry.js";
import { ConfigInvalidError } from "@/core/errors.js";

async function devStopAction(
  _ctx: CLIContext,
  name: string,
  options: { rm?: boolean },
): Promise<RunCommandResult> {
  const env = await readEnv(name);
  if (!env) {
    throw new ConfigInvalidError(
      `No dev env named "${name}". List envs with: base44 dev ps`,
    );
  }

  if (isPidAlive(env.pid)) {
    try {
      // Negative pid signals the whole process group (the daemon was started
      // detached, so it leads its own group — this also reaps the frontend).
      process.kill(-env.pid, "SIGTERM");
    } catch {
      try {
        process.kill(env.pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
  }

  if (options.rm) {
    await removeEnv(name);
    return { outroMessage: `Stopped and removed dev env "${name}"` };
  }

  await patchEnv(name, { status: "stopped" });
  return { outroMessage: `Stopped dev env "${name}"` };
}

export function getStopCommand(): Command {
  return new Base44Command("stop", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description("Stop a background dev env")
    .argument("<name>", "Env name")
    .option("--rm", "Also remove the env from the registry")
    .action(devStopAction);
}
