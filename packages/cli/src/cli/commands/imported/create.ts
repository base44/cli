import { renderStreamEvent } from "@/cli/commands/imported/render.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command, getDashboardUrl } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  appConfigExists,
  setAppContext,
  writeAppConfig,
} from "@/core/project/app-config.js";
import {
  createImportedApp,
  getImportedAppState,
  getImportedPreviewUrl,
  soleActiveBranchId,
} from "@/core/resources/imported/api.js";
import { streamConversationUntilSettled } from "@/core/resources/imported/stream.js";

const POLL_TIMEOUT_MS = 20 * 60_000;

interface CreateImportedOptions {
  blank?: boolean;
  repo?: string;
  repoName?: string;
  mode?: "direct" | "fork" | "copy";
  appName?: string;
  fromBranch?: string;
  prompt?: string;
}

async function createImportedAction(
  { log, runTask, jsonMode }: CLIContext,
  options: CreateImportedOptions,
): Promise<RunCommandResult> {
  if (options.blank && options.repo) {
    throw new InvalidInputError(
      "--blank starts from scratch; drop --repo, or drop --blank to import that repository.",
    );
  }
  if (options.blank && !options.repoName) {
    throw new InvalidInputError(
      "--blank needs --repo-name <name> for the fresh GitHub repository.",
    );
  }
  if (!options.blank && !options.repo) {
    throw new InvalidInputError(
      "Pass --repo <github-url> to import a repository, or --blank --repo-name <name> to start from scratch.",
    );
  }
  if (await appConfigExists(process.cwd())) {
    throw new InvalidInputError(
      "This directory is already linked to a Base44 app. Run the command from a fresh directory.",
    );
  }

  const sourceMode = options.blank ? "blank" : (options.mode ?? "direct");
  const appName =
    options.appName ??
    (options.blank
      ? (options.repoName as string)
      : ((options.repo as string).replace(/\/+$/, "").split("/").pop() ??
        "Imported app"));

  const created = await runTask(
    options.blank
      ? "Creating your repository and app"
      : "Importing the repository",
    () =>
      createImportedApp({
        appName,
        sourceMode,
        repoUrl: options.repo,
        newRepoName: options.repoName,
        branch: options.fromBranch,
        prompt: options.prompt,
      }),
  );

  const configPath = await writeAppConfig(process.cwd(), created.id);
  setAppContext({ id: created.id });

  let finalState: string | undefined;
  let previewUrl: string | undefined;
  if (options.prompt) {
    // The kickoff turn runs on the app's setup branch conversation. Completion
    // is the outcome stamp on the turn's user message — the app status field
    // flaps mid-turn and cannot be trusted.
    const branchId = await soleActiveBranchId().catch(() => undefined);
    if (!jsonMode) {
      log.message(
        "Agent is building — live (several minutes; safe to Ctrl+C, the build continues):",
      );
    }
    const settled = await streamConversationUntilSettled(
      (event) => {
        if (!jsonMode) log.message(renderStreamEvent(event));
      },
      { branchId, timeoutMs: POLL_TIMEOUT_MS },
    );
    finalState =
      settled === "timeout"
        ? "processing"
        : ((await getImportedAppState(created.id)).status?.state ?? "ready");
    if (finalState === "ready") {
      try {
        previewUrl = await runTask("Fetching preview URL", () =>
          getImportedPreviewUrl(),
        );
      } catch {
        // Preview may still be booting; the editor shows it when it's up.
      }
    }
  }

  const editorUrl = getDashboardUrl(created.id);
  if (jsonMode) {
    return {
      stdout: `${JSON.stringify({
        id: created.id,
        repo_url: created.imported_repo_url ?? null,
        editor_url: editorUrl,
        preview_url: previewUrl ?? null,
        status: finalState ?? "created",
      })}\n`,
    };
  }

  log.message(`App:      ${created.id}`);
  if (created.imported_repo_url)
    log.message(`Repo:     ${created.imported_repo_url}`);
  log.message(`Editor:   ${editorUrl}`);
  if (previewUrl) log.message(`Preview:  ${previewUrl}`);
  log.message(`Linked this directory (${configPath})`);
  if (finalState === "error") {
    return {
      outroMessage:
        "The first build reported an error — open the editor to see what the agent hit.",
    };
  }
  if (finalState === "processing") {
    return {
      outroMessage:
        "Still building — check progress in the editor or with `base44 imported status`.",
    };
  }
  return {
    outroMessage: options.prompt
      ? "First build finished."
      : "Imported app created.",
  };
}

export function getImportedCreateCommand(): Base44Command {
  const command = new Base44Command("create", { requireAppContext: false });
  command
    .description("Create an imported app from a GitHub repo, or from scratch")
    .option(
      "--blank",
      "Start from scratch in a fresh private GitHub repository",
    )
    .option("--repo <url>", "GitHub repository URL to import")
    .option(
      "--repo-name <name>",
      "Name for the new GitHub repository (--blank, or with --mode fork/copy)",
    )
    .option(
      "--mode <mode>",
      "How to import --repo: direct, fork, or copy (default: direct)",
    )
    .option("--app-name <name>", "Display name for the Base44 app")
    .option("--from-branch <name>", "Import a specific branch of --repo")
    .option(
      "--prompt <text>",
      "First message for the agent; the build starts immediately",
    )
    .action(createImportedAction);
  return command;
}
