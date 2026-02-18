import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { theme } from "@/cli/utils/theme.js";
import { invokeFunction } from "@/core/resources/function/index.js";

function collectHeader(
  value: string,
  previous: Record<string, string>,
): Record<string, string> {
  const idx = value.indexOf(":");
  if (idx === -1) {
    throw new Error(`Invalid header (expected "Name: Value"): ${value}`);
  }
  const name = value.slice(0, idx).trim();
  const headerValue = value.slice(idx + 1).trim();
  return { ...previous, [name]: headerValue };
}

function parseJsonArg(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
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
  options: {
    data?: string;
    timeout?: string;
    method?: string;
    header?: Record<string, string>;
    verbose?: boolean;
  },
): Promise<RunCommandResult> {
  const data = options.data ? parseJsonArg(options.data) : {};
  const method = options.method?.toUpperCase() ?? "POST";
  const timeout = options.timeout
    ? parseInt(options.timeout, 10) * 1000
    : undefined;

  if (!options.verbose) {
    log.info(
      `Invoking function ${theme.styles.bold(functionName)} (${method})`,
    );
  }

  const result = await runTask(
    "Running function",
    async () => {
      return await invokeFunction(functionName, data, {
        timeout,
        method,
        headers: options.header,
      });
    },
    {
      successMessage: options.verbose
        ? undefined
        : "Function executed successfully",
      errorMessage: "Function execution failed",
    },
  );

  if (options.verbose) {
    // curl-like verbose output
    log.info(theme.styles.dim("* Request:"));
    log.info(theme.styles.dim(`> ${result.method} ${result.url}`));
    for (const [key, value] of Object.entries(result.requestHeaders)) {
      // Don't show the full auth token for security
      const displayValue =
        key === "Authorization" ? "Bearer [REDACTED]" : value;
      log.info(theme.styles.dim(`> ${key}: ${displayValue}`));
    }
    if (Object.keys(data).length > 0) {
      log.info(theme.styles.dim(">"));
      log.info(theme.styles.dim(`> ${JSON.stringify(data)}`));
    }
    log.info(theme.styles.dim("*"));
    log.info(theme.styles.dim("* Response:"));
    log.info(
      theme.styles.dim(
        `< HTTP ${result.status} ${result.statusText} (${result.durationMs}ms)`,
      ),
    );
    for (const [key, value] of Object.entries(result.headers)) {
      log.info(theme.styles.dim(`< ${key}: ${value}`));
    }
    log.info(theme.styles.dim("<"));
  }

  const output =
    typeof result.body === "string"
      ? result.body
      : JSON.stringify(result.body, null, 2);

  if (options.verbose) {
    log.info(output);
  } else {
    log.info(`Response:\n${output}`);
  }

  return {
    outroMessage: options.verbose
      ? undefined
      : `Function ${theme.styles.bold(functionName)} completed`,
  };
}

export function getFunctionsInvokeCommand(context: CLIContext): Command {
  return new Command("invoke")
    .description("Invoke a deployed backend function")
    .argument("<function-name>", "Name of the function to invoke")
    .option("-X, --method <verb>", "HTTP method (default: POST)")
    .option(
      "-H, --header <header>",
      "Custom header (Name: Value), repeatable",
      collectHeader,
      {},
    )
    .option("-d, --data <json>", "JSON data to send to the function")
    .option("-t, --timeout <seconds>", "Timeout in seconds (default: 300)")
    .option(
      "-v, --verbose",
      "Verbose output (show request/response headers, status, timing)",
    )
    .action(async (functionName: string, options) => {
      await runCommand(
        () => invokeFunctionAction(functionName, options),
        { requireAuth: true },
        context,
      );
    });
}
