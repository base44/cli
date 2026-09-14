import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { targetOption } from "@/cli/commands/versions/options.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { deployVersion } from "@/core/version/index.js";

interface DeployOptions {
  target?: string;
}

/**
 * Serve a version that already exists. No checkout, no build and no upload —
 * which is also what a rollback is: the same call with an older version id.
 */
async function deployAction(
  { runTask, jsonMode }: CLIContext,
  versionId: string,
  options: DeployOptions,
): Promise<RunCommandResult> {
  const deployment = await runTask(
    `Deploying version ${versionId}...`,
    async () =>
      await deployVersion(versionId, {
        target: options.target,
        idempotencyKey: randomUUID(),
      }),
    { successMessage: "Version deployed", errorMessage: "Deploy failed" },
  );

  return {
    outroMessage: `Deployment ${deployment.deploymentId} at revision ${deployment.revision}`,
    stdout: jsonMode ? `${JSON.stringify(deployment, null, 2)}\n` : undefined,
  };
}

export function getVersionDeployCommand(): Command {
  return new Base44Command("deploy")
    .description(
      "Serve an already-recorded version (also how a rollback is done)",
    )
    .argument("<version-id>", "The version to serve")
    .addOption(targetOption())
    .action(deployAction);
}
