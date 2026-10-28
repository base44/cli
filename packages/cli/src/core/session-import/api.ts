import ky, { HTTPError, type KyResponse } from "ky";
import { z } from "zod";
import { getAppClient } from "@/core/clients/index.js";
import { getBase44ApiUrl } from "@/core/config.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

export const MAX_SESSION_BYTES = 25 * 1024 * 1024;

const SessionImportResponseSchema = z
  .object({
    branch_id: z.string(),
    branch_name: z.string(),
    source: z.enum(["claude_code", "codex"]),
    turn_count: z.number(),
    branch_url: z.string(),
    continued: z.boolean(),
    source_ref: z.string(),
  })
  .transform((data) => ({
    branchId: data.branch_id,
    branchName: data.branch_name,
    source: data.source,
    turnCount: data.turn_count,
    branchUrl: data.branch_url,
    continued: data.continued,
    sourceRef: data.source_ref,
  }));

type SessionImport = z.infer<typeof SessionImportResponseSchema>;

const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    details: z
      .object({ branch_name: z.string(), branch_url: z.string() })
      .partial()
      .optional(),
  }),
});

type ErrorDetails = z.infer<typeof ErrorEnvelopeSchema>["error"]["details"];

const NETWORK_BLOCKED =
  "Your Claude cloud environment can't reach Base44 yet. In the environment's settings, open Network access, add `app.base44.com` to Allowed domains, and try again.";

function messageFor(
  status: number,
  code: string | undefined,
  details: ErrorDetails,
  viaToken: boolean,
): string | undefined {
  if (code === "branch_exists" && details?.branch_url) {
    return `Base Code already has ${details.branch_name ?? "a branch for this session"}. Open it: ${new URL(details.branch_url, getBase44ApiUrl())}`;
  }
  if (code === "repository_not_connected") {
    return "Connect this app to its GitHub repository in Base Code first.";
  }
  if (status === 401 && viaToken) {
    return "This import key expired or was already used. In Base Code, open Import session and copy a new prompt.";
  }
  if (status === 403) {
    return "You don't have edit access to this app, or this key was made for a different app.";
  }
  if (status === 404) return "Session import isn't available for this app.";
  if (status === 413)
    return "This session is over 25 MB and can't be imported.";
  if (code === "unsupported_file") {
    return "That file isn't a Claude Code or Codex session.";
  }
  if (code === "repository_mismatch") {
    return "This session is from a different repository than the app.";
  }
  if (status === 429) return "Too many imports. Wait a minute and try again.";
  return undefined;
}

/**
 * A fresh error that carries no request or response body: the body is the
 * user's conversation, and error reporting sends ApiError fields to PostHog.
 */
async function toImportError(
  error: unknown,
  viaToken: boolean,
): Promise<ApiError> {
  if (!(error instanceof HTTPError)) {
    // No HTTP response: the claude.ai sandbox refuses the connection.
    const reason = error instanceof Error ? error.message : String(error);
    return new ApiError(
      process.env.CLAUDE_CODE_REMOTE
        ? NETWORK_BLOCKED
        : `Couldn't reach Base44: ${reason}`,
      { hints: [] },
    );
  }
  const { status } = error.response;
  const fallback = await ApiError.fromHttpError(error, "importing session");
  const envelope = ErrorEnvelopeSchema.safeParse(fallback.responseBody);
  const { code, details } = envelope.success ? envelope.data.error : {};
  // The claude.ai egress proxy answers a blocked host with its own non-JSON 403.
  const blocked =
    process.env.CLAUDE_CODE_REMOTE &&
    status === 403 &&
    typeof fallback.responseBody !== "object";
  const known = blocked
    ? NETWORK_BLOCKED
    : messageFor(status, code, details, viaToken);
  return new ApiError(known ?? fallback.message, {
    statusCode: status,
    requestUrl: error.request.url,
    requestMethod: error.request.method,
    requestId: fallback.requestId,
    // The CLI's default 401 hint says `base44 login`, which a key user doesn't need.
    hints: known ? [] : fallback.hints,
  });
}

/**
 * Uploads a session file. With an import key it goes through its own client:
 * base44Client would replace the Authorization header with the stored login and,
 * on a 401, refresh and retry as that user.
 */
export async function uploadSession(
  appId: string,
  content: Uint8Array,
  { token, sourceBranch }: { token?: string; sourceBranch?: string } = {},
): Promise<SessionImport> {
  const form = new FormData();
  form.append("file", new Blob([content]), "session.jsonl");
  // The backend starts the new branch from this one when it's on GitHub.
  if (sourceBranch) form.append("source_branch", sourceBranch);

  let response: KyResponse;
  try {
    response = token
      ? await ky.post(
          new URL(
            `/api/apps/${appId}/imported/session-imports`,
            getBase44ApiUrl(),
          ),
          {
            body: form,
            headers: {
              Authorization: `Bearer ${token}`,
              "User-Agent": "Base44 CLI",
            },
            timeout: 180_000,
          },
        )
      : await getAppClient().post("imported/session-imports", {
          body: form,
          timeout: 180_000,
        });
  } catch (error) {
    throw await toImportError(error, Boolean(token));
  }

  const result = SessionImportResponseSchema.safeParse(await response.json());
  if (!result.success) {
    throw new SchemaValidationError(
      "Invalid session import response from server",
      result.error,
    );
  }
  return result.data;
}
