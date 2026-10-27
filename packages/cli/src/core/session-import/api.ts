import { HTTPError } from "ky";
import { z } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import {
  encodeTurns,
  type SessionSource,
  type SessionTurn,
} from "@/core/session-import/transcript.js";

const ImportResponseSchema = z
  .object({ branch_id: z.string().min(1), branch_name: z.string().min(1) })
  .transform((data) => ({
    branchId: data.branch_id,
    branchName: data.branch_name,
  }));

interface ImportSessionParams {
  source: SessionSource;
  sessionId: string;
  title: string;
  turns: SessionTurn[];
}

interface ImportedSession {
  branchId: string;
  branchName: string;
  /** False when an identical import already made this branch. */
  created: boolean;
}

/**
 * Error reporting attaches a failed request's body. This one is the user's
 * conversation, so it is dropped before the error is built.
 */
function withoutTranscript(error: unknown): unknown {
  if (error instanceof HTTPError) {
    delete error.options.context.__requestBody;
  }
  return error;
}

function withUnavailableHint(error: ApiError): ApiError {
  if (error.statusCode !== 404) return error;
  return new ApiError(error.message, {
    statusCode: error.statusCode,
    requestUrl: error.requestUrl,
    requestMethod: error.requestMethod,
    responseBody: error.responseBody,
    requestId: error.requestId,
    details: error.details,
    hints: [
      {
        message:
          "Session import works on apps imported from a repository, and needs early access on your account. Check the app id.",
      },
    ],
    cause: error,
  });
}

export async function importSession(
  params: ImportSessionParams,
): Promise<ImportedSession> {
  let response: Response;
  try {
    response = await getAppClient().post("imported/session-imports", {
      json: {
        source: params.source,
        source_session_id: params.sessionId,
        title: params.title,
        turns_gzip_base64: encodeTurns(params.turns),
      },
      timeout: 60_000,
    });
  } catch (error) {
    throw withUnavailableHint(
      await ApiError.fromHttpError(
        withoutTranscript(error),
        "importing session",
      ),
    );
  }
  const result = ImportResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid session import response from server",
      result.error,
    );
  }
  return { ...result.data, created: response.status === 201 };
}
