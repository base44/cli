import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { theme } from "@/cli/utils/theme.js";
import { invokeFunction } from "@/core/resources/function/index.js";

function parseJsonArg(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Data must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (e) {
    throw new Error(
      `Invalid JSON data: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function invokeFunctionAction(
  functionName: string,
  options: { data?: string; timeout?: string },
): Promise<RunCommandResult> {
  const data = options.data ? parseJsonArg(options.data) : {};
  const timeout = options.timeout
    ? parseInt(options.timeout, 10) * 1000
    : undefined;

  log.info(`Invoking function ${theme.styles.bold(functionName)}`);

  const result = await runTask(
    "Running function",
    async () => {
      return await invokeFunction(functionName, data, { timeout });
    },
    {
      successMessage: "Function executed successfully",
      errorMessage: "Function execution failed",
    },
  );

  const output =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);

  log.info(`Response:\n${output}`);

  return {
    outroMessage: `Function ${theme.styles.bold(functionName)} completed`,
  };
}

export function getFunctionsInvokeCommand(context: CLIContext): Command {
  return new Command("invoke")
    .description("Invoke a deployed backend function")
    .argument("<function-name>", "Name of the function to invoke")
    .option("-d, --data <json>", "JSON data to send to the function")
    .option("-t, --timeout <seconds>", "Timeout in seconds (default: 300)")
    .action(async (functionName: string, options) => {
      await runCommand(
        () => invokeFunctionAction(functionName, options),
        { requireAuth: true },
        context,
      );
    });
}
