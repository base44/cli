import { Command } from "commander";
import { log } from "@clack/prompts";
import type { CLIContext } from "@/cli/types.js";
import { pushFunctions } from "@/core/resources/function/index.js";
import { readProjectConfig } from "@/core/index.js";
import { ApiError } from "@/core/errors.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";

async function deployFunctionsAction(): Promise<RunCommandResult> {
  const { functions } = await readProjectConfig();

  if (functions.length === 0) {
    return {
      outroMessage:
        "No functions found. Create functions in the 'functions' directory.",
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
    throw new ApiError(`Function deployment errors:\n${errorMessages}`, {
      hints: [
        { message: "Check the function code for syntax errors" },
        { message: "Ensure all imports are valid" },
      ],
    });
  }

  return { outroMessage: "Functions deployed to Base44" };
}

export function getFunctionsDeployCommand(context: CLIContext): Command {
  return new Command("functions")
    .description("Manage project functions")
    .addCommand(
      new Command("deploy")
        .description("Deploy local functions to Base44")
        .action(async () => {
          await runCommand(deployFunctionsAction, { requireAuth: true }, context);
        })
    );
}
