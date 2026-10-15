import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, ensureAuth } from "@/cli/utils/index.js";
import {
  getOperationContract,
  listOperations,
  matchOperation,
  sendApiRequest,
} from "@/core/api-spec/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  formatJson,
  formatResponseBody,
  loadSpecTask,
  REFRESH_OPTION_HELP,
  readRequestBody,
} from "./shared.js";

interface FetchOptions {
  body?: string;
  readOnly?: boolean;
  refresh?: boolean;
  help?: boolean;
}

async function findOperation(
  ctx: CLIContext,
  method: string,
  path: string,
  refresh?: boolean,
) {
  const { spec } = await loadSpecTask(ctx, refresh);
  const op = matchOperation(listOperations(spec), method, path);
  if (!op) {
    throw new InvalidInputError(
      `No operation in the API spec matches ${method} ${path}.`,
      {
        hints: [
          {
            message: "Find the operation and its path template",
            command: 'base44 api search "<what you want to do>"',
          },
        ],
      },
    );
  }
  return { spec, op };
}

async function fetchAction(
  ctx: CLIContext,
  methodArg: string | undefined,
  path: string | undefined,
  options: FetchOptions,
  command: Command,
): Promise<RunCommandResult> {
  if (!methodArg || !path) {
    if (options.help) {
      return { stdout: command.helpInformation() };
    }
    throw new InvalidInputError(
      "Provide a method and a path, e.g. GET /api/apps.",
    );
  }
  const method = methodArg.toUpperCase();

  if (options.help) {
    const { spec, op } = await findOperation(
      ctx,
      method,
      path,
      options.refresh,
    );
    return { stdout: formatJson(getOperationContract(spec, op)) };
  }

  // --help and the --read-only refusal send nothing, so they need no login.
  if (options.readOnly) {
    const { op } = await findOperation(ctx, method, path, options.refresh);
    if (!op.readOnly) {
      throw new InvalidInputError(
        `Refused under --read-only: ${op.method} ${op.path} is not a read-only operation. Nothing was sent.`,
      );
    }
  }

  await ensureAuth(ctx);
  const body = await readRequestBody(method, options.body);
  const text = await ctx.runTask(
    `Calling ${method} ${path}`,
    () => sendApiRequest(method, path, body),
    { successMessage: `Called ${method} ${path}` },
  );
  return { stdout: formatResponseBody(text) };
}

export function getApiFetchCommand(): Command {
  return new Base44Command("fetch", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description(
      "Call a Base44 API operation, like curl; add --help after a path for its contract",
    )
    .helpOption(false)
    .argument("[method]", "HTTP method, e.g. GET or POST")
    .argument(
      "[path]",
      'Concrete path with any query string, e.g. "/api/apps/<app-id>/workflows/runs?status=failed"',
    )
    .option(
      "--body <json>",
      "Request body: JSON, @file.json, or @- for stdin (piped stdin is read too)",
    )
    .option(
      "--read-only",
      "Refuse, before sending, any operation the spec does not mark read-only",
    )
    .option("--refresh", REFRESH_OPTION_HELP)
    .option(
      "-h, --help",
      "With a method and path, print that operation's contract; otherwise this help",
    )
    .action(fetchAction);
}
