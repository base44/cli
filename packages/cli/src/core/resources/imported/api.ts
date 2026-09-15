import type { KyResponse } from "ky";
import { z } from "zod";
import { base44Client, getAppClient } from "@/core/clients/index.js";
import { ApiError, SchemaValidationError } from "@/core/errors.js";

const GitStatusSchema = z.object({
  current_branch: z.string(),
  default_branch: z.string(),
  head: z.string().nullish(),
  dirty: z.boolean().default(false),
  dirty_files: z.array(z.string()).default([]),
  ahead: z.number().nullish(),
  behind: z.number().nullish(),
  sync_mode: z.string().default("synced"),
  merge_in_progress: z.boolean().default(false),
});
export type ImportedGitStatus = z.infer<typeof GitStatusSchema>;

const CreatedAppSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  imported_repo_url: z.string().nullish(),
});
type CreatedImportedApp = z.infer<typeof CreatedAppSchema>;

const AppStateSchema = z.object({
  id: z.string(),
  status: z
    .object({
      state: z.string().nullish(),
      message: z.string().nullish(),
    })
    .nullish(),
});
type ImportedAppState = z.infer<typeof AppStateSchema>;

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
export type ImportedChatTurn = z.infer<typeof ChatTurnSchema>;

const PullRequestSchema = z.object({
  html_url: z.string().nullish(),
  url: z.string().nullish(),
  number: z.number().nullish(),
  created: z.boolean().nullish(),
});
type ImportedPullRequest = z.infer<typeof PullRequestSchema>;

const PreviewUrlSchema = z.object({
  preview_url: z.string().min(1),
});

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

interface CreateImportedAppOptions {
  appName: string;
  sourceMode: "blank" | "direct" | "fork" | "copy";
  repoUrl?: string;
  newRepoName?: string;
  branch?: string;
  prompt?: string;
}

export async function createImportedApp(
  options: CreateImportedAppOptions,
): Promise<CreatedImportedApp> {
  let response: KyResponse;
  try {
    // Creation can fork/copy a repo on GitHub and classify the source, so it
    // legitimately outlives ky's default timeout.
    response = await base44Client.post("api/apps", {
      timeout: false,
      json: {
        app_type: "imported_app",
        name: options.appName,
        imported_source_mode: options.sourceMode,
        ...(options.repoUrl ? { imported_repo_url: options.repoUrl } : {}),
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
    throw await ApiError.fromHttpError(error, "creating imported app");
  }
  return parseOrThrow(CreatedAppSchema, await response.json(), "imported app");
}

export async function getImportedAppState(
  appId: string,
): Promise<ImportedAppState> {
  let response: KyResponse;
  try {
    response = await base44Client.get(`api/apps/${appId}`, {
      searchParams: { fields: "id,status" },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "reading app status");
  }
  return parseOrThrow(AppStateSchema, await response.json(), "app status");
}

export async function sendImportedChatMessage(
  content: string,
): Promise<ImportedChatTurn> {
  let response: KyResponse;
  try {
    // The request stays open for the whole agent turn (minutes on big changes).
    response = await getAppClient().post("chat/message", {
      timeout: false,
      searchParams: { conversation_messages: "current_turn" },
      json: { content },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "sending chat message");
  }
  return parseOrThrow(ChatTurnSchema, await response.json(), "chat turn");
}

export async function getImportedGitStatus(
  branchId?: string,
): Promise<ImportedGitStatus> {
  let response: KyResponse;
  try {
    // A cold sandbox is re-provisioned before git can answer.
    response = await getAppClient().get("imported/git/status", {
      timeout: false,
      searchParams: branchScope(branchId),
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "reading git status");
  }
  return parseOrThrow(GitStatusSchema, await response.json(), "git status");
}

export async function commitImportedChanges(
  message?: string,
  branchId?: string,
): Promise<ImportedGitStatus> {
  let response: KyResponse;
  try {
    response = await getAppClient().post("imported/git/commit", {
      timeout: false,
      searchParams: branchScope(branchId),
      json: { ...(message ? { message } : {}) },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "committing changes");
  }
  return parseOrThrow(GitStatusSchema, await response.json(), "git status");
}

export async function discardImportedChanges(
  branchId?: string,
): Promise<ImportedGitStatus> {
  let response: KyResponse;
  try {
    response = await getAppClient().post("imported/git/discard", {
      timeout: false,
      searchParams: branchScope(branchId),
      json: {},
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "discarding changes");
  }
  return parseOrThrow(GitStatusSchema, await response.json(), "git status");
}

export async function openImportedPullRequest(
  title: string,
  body: string,
  branchId?: string,
): Promise<ImportedPullRequest> {
  let response: KyResponse;
  try {
    response = await getAppClient().post("imported/git/pull-request", {
      timeout: false,
      searchParams: branchScope(branchId),
      json: { title, body },
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "opening pull request");
  }
  return parseOrThrow(PullRequestSchema, await response.json(), "pull request");
}

export async function getImportedPreviewUrl(): Promise<string> {
  let response: KyResponse;
  try {
    // Rehydrates a dead sandbox before answering, so it can take a while.
    response = await getAppClient().get("sandbox/preview-url", {
      timeout: false,
    });
  } catch (error) {
    throw await ApiError.fromHttpError(error, "fetching preview URL");
  }
  return parseOrThrow(PreviewUrlSchema, await response.json(), "preview URL")
    .preview_url;
}
