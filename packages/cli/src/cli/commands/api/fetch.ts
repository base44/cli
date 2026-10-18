import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import {
  type AppIdOptions,
  Base44Command,
  ensureAppContext,
  ensureAuth,
  requireApp,
} from "@/cli/utils/index.js";
import {
  type ApiResponse,
  getOperationContract,
  listOperations,
  matchOperation,
  normalizePath,
  sendApiRequest,
} from "@/core/api-spec/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { writeFile } from "@/core/utils/fs.js";
import {
  formatJson,
  loadSpecTask,
  REFRESH_OPTION_HELP,
  readFormBody,
  readRequestBody,
  reportedFetchCommand,
  withoutQuery,
} from "./shared.js";

interface FetchOptions {
  body?: string;
  form: string[];
  output?: string;
  readOnly?: boolean;
  refresh?: boolean;
  help?: boolean;
}

async function findOperation(
  ctx: CLIContext,
  method: string,
  path: string,
  { refresh, flag }: { refresh?: boolean; flag: "--help" | "--read-only" },
) {
  const { spec } = await loadSpecTask(ctx, refresh);
  const op = matchOperation(listOperations(spec), method, path);
  if (!op) {
    throw new InvalidInputError(
      `No operation in the API spec matches ${method} ${withoutQuery(path)}.`,
      {
        hints: [
          {
            message: "The cached spec may predate this route; fetch it again",
            command: `base44 api fetch ${method} ${path} ${flag} --refresh`,
          },
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

const ENCODED_SEPARATOR = /%(2f|5c|2e)/i;

/** Fills `{app_id}` from `--app-id` or the project; any other placeholder must be filled by hand. */
async function fillAppId(
  ctx: CLIContext,
  path: string,
  command: Command,
): Promise<string> {
  let filled = path;
  if (withoutQuery(path).includes("{app_id}")) {
    const { appId } = command.optsWithGlobals<AppIdOptions>();
    await ensureAppContext(ctx, { appId });
    filled = path.replaceAll("{app_id}", requireApp(ctx).id);
  }
  const placeholder = withoutQuery(filled).match(/\{[^}/]*\}/);
  if (placeholder) {
    throw new InvalidInputError(
      `Replace ${placeholder[0]} in the path with a real value; only {app_id} is filled in.`,
    );
  }
  return filled;
}

const MULTIPART_HINT =
  "Send this body with --form name=value, and --form name=@path for files.";

const CONTRACT_HELP =
  "The contract is JSON; cut it down with e.g. | jq '.parameters, .requestBodySchema'";

const TEXT_CONTENT_TYPES = [
  "json",
  "text/",
  "xml",
  "javascript",
  "x-www-form-urlencoded",
];

/**
 * The body as text, or undefined when it is binary: a declared non-text type,
 * or bytes that aren't valid UTF-8 (a body without a content type, say).
 */
function decodeText(body: Uint8Array, contentType: string): string | undefined {
  const type = contentType.toLowerCase();
  if (type && !TEXT_CONTENT_TYPES.some((hint) => type.includes(hint))) {
    return undefined;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return undefined;
  }
}

/**
 * The body as the server sent it. JSON is pretty-printed only in a terminal:
 * re-serializing would round integers above 2^53. Under --json a non-JSON
 * text body is wrapped; an empty body prints its status; a binary one is
 * described, and saved only with --output.
 */
async function formatResponse(
  { status, contentType, body }: ApiResponse,
  output: string | undefined,
  jsonMode: boolean,
): Promise<string> {
  if (output) {
    await writeFile(output, body);
    return formatJson({ status, contentType, bytes: body.length, output });
  }
  if (body.length === 0) {
    return formatJson({ status });
  }
  const text = decodeText(body, contentType);
  if (text === undefined) {
    return formatJson({
      status,
      contentType,
      bytes: body.length,
      note: "Binary body not printed; add --output <file> to save it.",
    });
  }
  const asIs = text.endsWith("\n") ? text : `${text}\n`;
  try {
    const parsed: unknown = JSON.parse(text);
    return process.stdout.isTTY ? formatJson(parsed) : asIs;
  } catch {
    return jsonMode ? formatJson({ status, contentType, body: text }) : asIs;
  }
}

async function fetchAction(
  ctx: CLIContext,
  methodArg: string | undefined,
  path: string | undefined,
  options: FetchOptions,
  command: Command,
): Promise<RunCommandResult> {
  // First: the CLI recorded the raw arguments and --body for error reporting,
  // and any endpoint's body or query can carry secrets.
  ctx.errorReporter.setContext({
    command: reportedFetchCommand(methodArg ?? "", path ?? "", { ...options }),
  });
  if (!methodArg || !path) {
    if (options.help) {
      // helpInformation() leaves out addHelpText, so add the line here too.
      const usage = `${command.helpInformation()}\n${CONTRACT_HELP}\n`;
      return { stdout: ctx.jsonMode ? formatJson({ usage }) : usage };
    }
    throw new InvalidInputError(
      "Provide a method and a path, e.g. GET /api/apps.",
    );
  }
  const method = methodArg.toUpperCase();

  if (options.help) {
    const { spec, op } = await findOperation(ctx, method, normalizePath(path), {
      refresh: options.refresh,
      flag: "--help",
    });
    const contract = getOperationContract(spec, op);
    return {
      stdout: formatJson(
        contract.requestBodyContentType === "multipart/form-data"
          ? { ...contract, hint: MULTIPART_HINT }
          : contract,
      ),
    };
  }

  const target = normalizePath(await fillAppId(ctx, path, command));

  // --help and the --read-only refusal send nothing, so they need no login.
  if (options.readOnly) {
    // The server routes the decoded path, which this check would not see.
    if (ENCODED_SEPARATOR.test(withoutQuery(target))) {
      throw new InvalidInputError(
        "Refused under --read-only: the path has an encoded /, \\ or ., so it can't be checked. Nothing was sent.",
      );
    }
    const { op } = await findOperation(ctx, method, target, {
      refresh: options.refresh,
      flag: "--read-only",
    });
    if (!op.readOnly) {
      throw new InvalidInputError(
        `Refused under --read-only: ${op.method} ${op.path} is not a read-only operation. Nothing was sent.`,
      );
    }
  }

  if (options.body !== undefined && options.form.length > 0) {
    throw new InvalidInputError("Use --body or --form, not both.");
  }
  await ensureAuth(ctx);
  const body =
    options.form.length > 0
      ? await readFormBody(options.form)
      : await readRequestBody(options.body);
  const response = await ctx.runTask(
    `Calling ${method} ${target}`,
    () => sendApiRequest(method, target, body),
    {
      successMessage: `Called ${method} ${target}`,
      errorMessage: "Request failed",
    },
  );
  return {
    stdout: await formatResponse(response, options.output, ctx.jsonMode),
  };
}

export function getApiFetchCommand(): Command {
  return new Base44Command("fetch", {
    requireAuth: false,
    requireAppContext: false,
  })
    .description(
      "Call a Base44 API operation; add --help after a path for its contract",
    )
    .helpOption(false)
    .argument("[method]", "HTTP method, e.g. GET or POST")
    .argument(
      "[path]",
      'Path with any query string; {app_id} is filled from --app-id or the project, e.g. "/api/apps/{app_id}/workflows/runs?status=failed"',
    )
    .option(
      "--body <json>",
      "Request body: JSON, @file.json, or @- to read it from stdin",
    )
    .option(
      "--form <field>",
      "Multipart field: name=value, or name=@file to attach a file (repeatable)",
      (field: string, fields: string[]) => [...fields, field],
      [],
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
    .addHelpText("after", `\n${CONTRACT_HELP}`)
    .action(fetchAction);
}
