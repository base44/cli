import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import {
  DEFAULT_ENVIRONMENT,
  setEnvironmentVersion,
} from "@/core/version/index.js";

/** Point an environment at an existing version: no checkout, no build, no
 * upload. Pointing it at an older one is the rollback. */
async function deployAction(
  { runTask, jsonMode }: CLIContext,
  versionId: string,
  options: { target?: string },
): Promise<RunCommandResult> {
  const environment = options.target ?? DEFAULT_ENVIRONMENT;
  const result = await runTask(
    `Pointing ${environment} at ${versionId}...`,
    async () =>
      await setEnvironmentVersion(environment, versionId, {
        idempotencyKey: randomUUID(),
      }),
    {
      successMessage: "Environment updated",
      errorMessage: "Could not update the environment",
    },
  );

  return {
    outroMessage: `${result.name} now serves ${result.versionId}`,
    stdout: jsonMode ? `${JSON.stringify(result, null, 2)}\n` : undefined,
  };
}

export function getVersionDeployCommand(): Command {
  return new Base44Command("deploy")
    .description(
      "Point an environment at an already-recorded version (also the rollback)",
    )
    .argument("<version-id>", "The version to serve")
    .option("--target <name>", "Environment to point at it")
    .action(deployAction);
}
