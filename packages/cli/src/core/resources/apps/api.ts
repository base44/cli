import type { KyResponse } from "ky";
import { z } from "zod";
import { base44Client, getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";
import { listBranches } from "@/core/resources/branch/api.js";

const CreatedAppSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  imported_repo_url: z.string().nullish(),
});
type CreatedApp = z.infer<typeof CreatedAppSchema>;

const WixCreatedAppSchema = z.object({
  app_id: z.string().min(1),
  client_creation_id: z.string().min(1),
});

const AppStateSchema = z.object({
  id: z.string(),
  app_type: z.string().nullish(),
  is_managed_source_code: z.boolean().nullish(),
  imported_repo_url: z.string().nullish(),
  status: z
    .object({
      state: z.string().nullish(),
      message: z.string().nullish(),
      error_source: z.string().nullish(),
    })
    .nullish(),
});
export type AppState = z.infer<typeof AppStateSchema>;

const ChatTurnSchema = z.object({
  queued: z.boolean().optional(),
  status: z
    .object({
      state: z.string().nullish(),
      message: z.string().nullish(),
      error_source: z.string().nullish(),
    })
    .nullish(),
  conversation: z
    .object({
      messages: z
        .array(
          z.object({
            role: z.string().nullish(),
            content: z.unknown().nullish(),
          }),
        )
        .nullish(),
    })
    .nullish(),
});
export type ChatTurn = z.infer<typeof ChatTurnSchema>;

const PreviewUrlSchema = z.object({
  preview_url: z.string().min(1),
});

const ConversationMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  hidden: z.boolean().nullish(),
  outcome: z.unknown().nullish(),
  content: z.unknown().nullish(),
  reasoning: z.object({ content: z.string().nullish() }).nullish(),
  tool_calls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments_string: z.string().nullish(),
        status: z.string().nullish(),
        results: z.unknown().nullish(),
        /** Why the call is parked: approval, choice, or input. */
        waiting_on: z.object({ kind: z.string().nullish() }).nullish(),
      }),
    )
    .nullish(),
});
export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

const FullConversationSchema = z.object({
  messages: z.array(ConversationMessageSchema).default([]),
});

const OAuthInitiateSchema = z.object({ authorization_url: z.string().min(1) });

function parseOrThrow<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  what: string,
): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new SchemaValidationError(
      `Invalid ${what} response from server`,
      result.error,
    );
  }
  return result.data;
}

function branchScope(branchId?: string): Record<string, string> {
  return branchId ? { branch_id: branchId } : {};
}

interface CreateAppOptions {
  appName?: string;
  prompt?: string;
  organizationId?: string;
}

interface WixLaunchOptions {
  prompt: string;
  /** The signed Wix instance from the launch URL's fragment. */
  signedInstance: string;
  /** The companion OAuth app's client id, when the launch carried one. */
  wixClientId?: string;
}

/** Create an app through the Wix launch route: the backend verifies the signed
 * instance, connects the Wix connector BEFORE the first turn, and starts that
 * turn from the prompt — the one thing `POST /api/apps` cannot do. */
export async function createWixLaunchedApp(
  options: WixLaunchOptions,
): Promise<CreatedApp & { client_creation_id: string }> {
  let response: KyResponse;
  try {
    response = await base44Client.post("api/wix/create-app", {
      timeout: false,
      context: { __redactBody: true }, // carries the signed instance
      json: {
        prompt: options.prompt,
        signed_instance: options.signedInstance,
        ...(options.wixClientId ? { wix_client_id: options.wixClientId } : {}),
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "creating app via Wix launch");
  }
  const created = parseOrThrow(
    WixCreatedAppSchema,
    await response.json(),
    "app",
  );
  return { id: created.app_id, client_creation_id: created.client_creation_id };
}

/** Create a standard Base44 app (builder agent + React template). No
 * app_type is sent — the backend defaults to user_app. A prompt auto-starts
 * the first turn in the background; poll the conversation to follow it. */
export async function createApp(
  options: CreateAppOptions,
): Promise<CreatedApp> {
  let response: KyResponse;
  try {
    response = await base44Client.post("api/apps", {
      timeout: false,
      json: {
        ...(options.appName ? { name: options.appName } : {}),
        ...(options.organizationId
          ? { organization_id: options.organizationId }
          : {}),
        ...(options.prompt
          ? { initial_message: { content: options.prompt } }
          : {}),
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "creating app");
  }
  return parseOrThrow(CreatedAppSchema, await response.json(), "app");
}

export type ImportSourceMode = "direct" | "fork" | "copy";

interface CreateImportedAppOptions {
  appName: string;
  repoUrl: string;
  sourceMode: ImportSourceMode;
  /** Name for the new GitHub repository when forking/copying. */
  newRepoName?: string;
  /** Import a specific branch of the source repo. */
  branch?: string;
  prompt?: string;
}

/** Create an app over an existing GitHub repository. Forking/copying runs on
 * the caller's GitHub token, so this can outlive ky's default timeout. */
export async function createImportedApp(
  options: CreateImportedAppOptions,
): Promise<CreatedApp> {
  let response: KyResponse;
  try {
    response = await base44Client.post("api/apps", {
      timeout: false,
      json: {
        app_type: "imported_app",
        name: options.appName,
        imported_source_mode: options.sourceMode,
        imported_repo_url: options.repoUrl,
        ...(options.newRepoName
          ? { imported_new_repo_name: options.newRepoName }
          : {}),
        ...(options.branch ? { imported_branch: options.branch } : {}),
        ...(options.prompt
          ? { initial_message: { content: options.prompt } }
          : {}),
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "importing repository");
  }
  return parseOrThrow(CreatedAppSchema, await response.json(), "app");
}

/** Authorize URL for a fresh account-only GitHub OAuth. Recovers an expired
 * connection: import verifies repo access with the caller's token, and GitHub
 * 401s a stale one — re-authorizing fixes it, retrying does not. */
export async function startGithubReauth(): Promise<string> {
  const response = await base44Client.post(
    "api/github/oauth/initiate?skip_installation=true",
  );
  return parseOrThrow(
    OAuthInitiateSchema,
    await response.json(),
    "github oauth initiate",
  ).authorization_url;
}

/** GitHub rejecting the caller's OAuth token — a 401 against api.github.com. */
export function isGithubUserTokenError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /api\.github\.com/i.test(message) && /\b401\b|unauthorized/i.test(message)
  );
}

export async function getAppState(appId: string): Promise<AppState> {
  let response: KyResponse;
  try {
    response = await base44Client.get(`api/apps/${appId}`, {
      searchParams: {
        fields: "id,status,app_type,is_managed_source_code,imported_repo_url",
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "reading app status");
  }
  return parseOrThrow(AppStateSchema, await response.json(), "app status");
}

export type ToolCallAction = "approved" | "rejected";

/** Answer a tool call the agent parked with `waiting_for_user_input`. The
 * backend resumes the tool and starts a new turn; like `sendTurn`, the request
 * stays open until that turn finishes. `input` is the tool's `extra_user_input`
 * (e.g. `{answers}`, `{secrets}`, `{approved_permission_keys}`, or `{}`). The
 * body may carry secret values, so it is never captured for telemetry. */
export async function answerToolCall(
  options: {
    toolCallId: string;
    messageId?: string;
    action: ToolCallAction;
    input?: Record<string, unknown>;
  },
  branchId?: string,
): Promise<ChatTurn> {
  let response: KyResponse;
  try {
    response = await getAppClient().post("chat/submit-tool-call-input", {
      timeout: false,
      context: { __redactBody: true },
      searchParams: branchScope(branchId),
      json: {
        tool_call_id: options.toolCallId,
        action: options.action,
        extra_user_input: options.input ?? {},
        ...(options.messageId ? { message_id: options.messageId } : {}),
      },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "answering the agent");
  }
  return parseOrThrow(ChatTurnSchema, await response.json(), "chat turn");
}

/** One agent turn. The request stays open until the turn finishes. */
export async function sendTurn(
  content: string,
  branchId?: string,
): Promise<ChatTurn> {
  let response: KyResponse;
  try {
    response = await getAppClient().post("chat/message", {
      timeout: false,
      searchParams: {
        conversation_messages: "current_turn",
        ...branchScope(branchId),
      },
      json: { content },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "sending message");
  }
  return parseOrThrow(ChatTurnSchema, await response.json(), "chat turn");
}

/** Server-side stop of the running turn on the given branch. */
export async function stopTurn(branchId?: string): Promise<void> {
  try {
    await getAppClient().post("chat/stop", {
      searchParams: branchScope(branchId),
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "stopping the turn");
  }
}

export async function getFullConversation(
  limit: number,
  branchId?: string,
): Promise<ConversationMessage[]> {
  let response: KyResponse;
  try {
    response = await getAppClient().get("chat/full-conversation", {
      timeout: 30_000,
      searchParams: { limit: String(limit), ...branchScope(branchId) },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "reading the conversation");
  }
  return parseOrThrow(
    FullConversationSchema,
    await response.json(),
    "conversation",
  ).messages;
}

/** The branch the app's work happens on, when unambiguous. A request with no
 * branch targets main; an imported app works on its single setup branch, so
 * unscoped messages would land on the wrong line. */
export async function resolveActiveBranchId(): Promise<string | undefined> {
  const branches = await listBranches();
  return branches.length === 1 ? branches[0].id : undefined;
}

/** Live preview URL. Rehydrates a cold sandbox first, so it can take a while. */
export async function getPreviewUrl(): Promise<string> {
  let response: KyResponse;
  try {
    response = await getAppClient().get("sandbox/preview-url", {
      timeout: false,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching preview URL");
  }
  const url = parseOrThrow(
    PreviewUrlSchema,
    await response.json(),
    "preview URL",
  ).preview_url;
  return /^https?:\/\//.test(url) ? url : `https://${url}`;
}
