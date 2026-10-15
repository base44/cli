import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, ensureAuth } from "@/cli/utils/index.js";
import {
  type ApiResponse,
  getOperationContract,
  listOperations,
  matchOperation,
  sendApiRequest,
} from "@/core/api-spec/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { writeFile } from "@/core/utils/fs.js";
import {
  formatJson,
  loadSpecTask,
  REFRESH_OPTION_HELP,
  readRequestBody,
} from "./shared.js";

interface FetchOptions {
  body?: string;
  output?: string;
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

const TEXT_CONTENT_TYPES = [
  "json",
  "text/",
  "xml",
  "javascript",
  "x-www-form-urlencoded",
];

function isText(contentType: string): boolean {
  return (
    !contentType ||
    TEXT_CONTENT_TYPES.some((hint) => contentType.toLowerCase().includes(hint))
  );
}

/**
 * The body as JSON when it is JSON, else as text. An empty body prints its
 * status, and a binary one is saved only with --output (decoding it would corrupt it).
 */
async function formatResponse(
  { status, contentType, body }: ApiResponse,
  output: string | undefined,
): Promise<string> {
  if (output !== undefined) {
    await writeFile(output, body);
    return formatJson({ status, contentType, bytes: body.length, output });
  }
  if (body.length === 0) {
    return formatJson({ status });
  }
  if (!isText(contentType)) {
    throw new InvalidInputError(
      `The response is binary (${contentType}, ${body.length} bytes), so it was not printed. The request was sent; add --output <file> to save the response.`,
    );
  }
  const text = new TextDecoder().decode(body);
  try {
    return formatJson(JSON.parse(text));
  } catch {
    return text.endsWith("\n") ? text : `${text}\n`;
  }
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
  const response = await ctx.runTask(
    `Calling ${method} ${path}`,
    () => sendApiRequest(method, path, body),
    {
      successMessage: `Called ${method} ${path}`,
      errorMessage: "Request failed",
    },
  );
  return { stdout: await formatResponse(response, options.output) };
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
    .option("--output <file>", "Save the response body to a file")
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
