import type { KyResponse } from "ky";
import type { z } from "zod";
import { getSandboxClient } from "@/core/clients/base44-client.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  CreateCheckpointParams,
  CreateCheckpointResponse,
  EditFileParams,
  EditFileResponse,
  GrepParams,
  GrepResponse,
  ListDirectoryParams,
  ListDirectoryResponse,
  ReadFileParams,
  ReadFileResponse,
  RunCommandParams,
  RunCommandResponse,
  WriteFileParams,
  WriteFileResponse,
} from "@/core/resources/sandbox/schema.js";
import {
  CreateCheckpointResponseSchema,
  EditFileResponseSchema,
  GrepResponseSchema,
  ListDirectoryResponseSchema,
  ReadFileResponseSchema,
  RunCommandResponseSchema,
  WriteFileResponseSchema,
} from "@/core/resources/sandbox/schema.js";

/**
 * Detect a genuine "missing sandbox OAuth scope" rejection. The backend only
 * emits this when the scope is enforced (the MCP surface — see
 * sandbox_tools.py: "Missing required OAuth scope 'sandbox:write'. Reconnect
 * granting sandbox access."). The HTTP endpoints the CLI calls authorize via
 * the platform JWT + app-admin and do NOT check the scope, so their 401/403s
 * (feature-flag-off, blocked app, view-only, wrong app type) are generic and
 * are NOT fixed by re-login — we must not slap a re-login hint on those.
 */
function isMissingSandboxScope(error: ApiError): boolean {
  if (error.statusCode !== 401 && error.statusCode !== 403) {
    return false;
  }
  const text = `${error.message} ${JSON.stringify(error.responseBody ?? "")}`;
  return /sandbox:write/i.test(text) || /granting sandbox access/i.test(text);
}

/**
 * Add a "re-login to grant sandbox access" hint, but only when the response
 * actually indicates a missing `sandbox:write` scope — re-running the
 * device-login flow is what grants it. Other auth failures pass through with
 * the server's original guidance untouched.
 */
function withSandboxAuthHint(error: ApiError): ApiError {
  if (!isMissingSandboxScope(error)) {
    return error;
  }
  return new ApiError(error.message, {
    statusCode: error.statusCode,
    requestUrl: error.requestUrl,
    requestMethod: error.requestMethod,
    requestBody: error.requestBody,
    responseBody: error.responseBody,
    requestId: error.requestId,
    details: error.details,
    hints: [
      ...error.hints,
      {
        message:
          "Run 'base44 login' again to grant sandbox access (the sandbox:write scope is only granted at login).",
        command: "base44 login",
      },
    ],
    cause: error,
  });
}

async function callTool<T>(
  appId: string,
  tool: string,
  payload: Record<string, unknown>,
  schema: z.ZodType<T>,
  context: string,
  timeout: number | false = 60_000,
): Promise<T> {
  const client = getSandboxClient(appId);

  let response: KyResponse;
  try {
    response = await client.post(tool, { json: payload, timeout });
  } catch (error) {
    throw withSandboxAuthHint(await ApiError.fromHttpError(error, context));
  }

  const result = schema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid response from server",
      result.error,
    );
  }
  return result.data;
}

export function listDirectory(
  appId: string,
  params: ListDirectoryParams,
): Promise<ListDirectoryResponse> {
  return callTool(
    appId,
    "list_directory",
    { ...params },
    ListDirectoryResponseSchema,
    "listing directory",
  );
}

export function readFile(
  appId: string,
  params: ReadFileParams,
): Promise<ReadFileResponse> {
  return callTool(
    appId,
    "read_file",
    { ...params },
    ReadFileResponseSchema,
    "reading file",
  );
}

export function writeFile(
  appId: string,
  params: WriteFileParams,
): Promise<WriteFileResponse> {
  return callTool(
    appId,
    "write_file",
    { ...params },
    WriteFileResponseSchema,
    `writing file "${params.path}"`,
  );
}

export function editFile(
  appId: string,
  params: EditFileParams,
): Promise<EditFileResponse> {
  return callTool(
    appId,
    "edit_file",
    { ...params },
    EditFileResponseSchema,
    `editing file "${params.path}"`,
  );
}

export function grep(appId: string, params: GrepParams): Promise<GrepResponse> {
  return callTool(
    appId,
    "grep",
    { ...params },
    GrepResponseSchema,
    "searching files",
  );
}

export function runCommand(
  appId: string,
  params: RunCommandParams,
): Promise<RunCommandResponse> {
  // The remote command has its own timeout (timeout_ms); don't impose a tighter
  // HTTP timeout that would abort a legitimately long-running command.
  return callTool(
    appId,
    "run_command",
    { ...params },
    RunCommandResponseSchema,
    "running command",
    false,
  );
}

export function createCheckpoint(
  appId: string,
  params: CreateCheckpointParams,
): Promise<CreateCheckpointResponse> {
  return callTool(
    appId,
    "create_checkpoint",
    { ...params },
    CreateCheckpointResponseSchema,
    "creating checkpoint",
  );
}
