import type { KyResponse } from "ky";
import type { z } from "zod";
import { getSandboxClient } from "@/core/clients/base44-client.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import type {
  EditFileParams,
  EditFileResponse,
  GrepParams,
  GrepResponse,
  ListDirectoryParams,
  ListDirectoryResponse,
  ReadFileParams,
  ReadFileResponse,
  ReleaseResponse,
  RunCommandParams,
  RunCommandResponse,
  WriteFileParams,
  WriteFileResponse,
} from "@/core/resources/sandbox/schema.js";
import {
  EditFileResponseSchema,
  GrepResponseSchema,
  ListDirectoryResponseSchema,
  ReadFileResponseSchema,
  ReleaseResponseSchema,
  RunCommandResponseSchema,
  WriteFileResponseSchema,
} from "@/core/resources/sandbox/schema.js";

/**
 * Sandbox access needs the `sandbox:write` OAuth scope, which is only granted
 * at login time. A token issued before sandbox support (or by a flow that
 * didn't request the scope) surfaces as a 403. Re-issuing the device-login
 * flow fixes it, so add that hint to forbidden responses without dropping the
 * server's original guidance.
 */
function withSandboxAuthHint(error: ApiError): ApiError {
  if (error.statusCode !== 403) {
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
          "If you have admin access to this app, your login may predate sandbox support — run 'base44 login' again to grant sandbox access.",
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

export function releaseSession(appId: string): Promise<ReleaseResponse> {
  return callTool(
    appId,
    "release",
    {},
    ReleaseResponseSchema,
    "releasing sandbox session",
  );
}
