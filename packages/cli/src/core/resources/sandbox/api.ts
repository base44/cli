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
    throw await ApiError.fromHttpError(error, context);
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
