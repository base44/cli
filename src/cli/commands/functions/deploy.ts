import { Command } from "commander";
import { pushFunctions } from "@core/resources/function/index.js";
import { readProjectConfig } from "@core/index.js";
import { runCommand, runTask, log } from "../../utils/index.js";
import type { RunCommandResult } from "../../utils/runCommand.js";

/**
 * JSON output result for the functions deploy command.
 */
interface FunctionsDeployResult {
  /** Names of functions that were successfully deployed. */
  deployed: string[];
  /** Names of functions that were deleted from the server. */
  deleted: string[];
}

async function deployFunctionsAction(): Promise<RunCommandResult<FunctionsDeployResult>> {
  const { functions } = await readProjectConfig();

  if (functions.length === 0) {
    return {
      outroMessage:
        "No functions found. Create functions in the 'functions' directory.",
      data: { deployed: [], deleted: [] },
    };
  }

  log.info(
    `Found ${functions.length} ${functions.length === 1 ? "function" : "functions"} to deploy`
  );

  const result = await runTask(
    "Deploying functions to Base44",
    async () => {
      return await pushFunctions(functions);
    },
    {
      successMessage: "Functions deployed successfully",
      errorMessage: "Failed to deploy functions",
    }
  );

  if (result.deployed.length > 0) {
    log.success(`Deployed: ${result.deployed.join(", ")}`);
  }
  if (result.deleted.length > 0) {
    log.warn(`Deleted: ${result.deleted.join(", ")}`);
  }

  if (result.errors && result.errors.length > 0) {
    const errorMessages = result.errors
      .map((e) => `'${e.name}' function: ${e.message}`)
      .join("\n");
    throw new Error(`Function deployment errors:\n${errorMessages}`);
  }

  return {
    data: {
      deployed: result.deployed,
      deleted: result.deleted,
    },
  };
}

export const functionsDeployCommand = new Command("functions")
  .description("Manage project functions")
  .addCommand(
    new Command("deploy")
      .description("Deploy local functions to Base44")
      .action(async () => {
        await runCommand(deployFunctionsAction, { requireAuth: true });
      })
  );
