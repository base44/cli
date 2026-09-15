import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runIterationLoop } from "@/cli/commands/imported/iterate.js";
import { createTurnStream } from "@/cli/commands/imported/render.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { getBase44ApiUrl } from "@/core/config.js";
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
  name: string | undefined,
  options: CreateImportedOptions,
): Promise<RunCommandResult> {
  // The positional name is the whole identity: directory, GitHub repo, app.
  const repoName = options.repoName ?? name;
  // A bare name means "from scratch" — --blank stays for explicitness.
  const blank = options.blank || (Boolean(name) && !options.repo);
  if (blank && options.repo) {
    throw new InvalidInputError(
      "A from-scratch create takes no --repo; drop it, or drop --blank to import that repository.",
    );
  }
  if (blank && !repoName) {
    throw new InvalidInputError(
      "Starting from scratch needs a name: `imported create <name>` (or --repo-name <name>).",
    );
  }
  if (!blank && !options.repo) {
    throw new InvalidInputError(
      "Pass a <name> to start from scratch, or --repo <github-url> to import a repository.",
    );
  }
  if (name && !/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new InvalidInputError(
      "The name becomes a directory and a GitHub repository — letters, digits, dots, dashes and underscores only.",
    );
  }

  const targetDir = name ? join(process.cwd(), name) : process.cwd();
  if (name) await mkdir(targetDir, { recursive: true });
  if (await appConfigExists(targetDir)) {
    throw new InvalidInputError(
      name
        ? `./${name} is already linked to a Base44 app. Pick another name.`
        : "This directory is already linked to a Base44 app. Run the command from a fresh directory.",
    );
  }

  const sourceMode = blank ? "blank" : (options.mode ?? "direct");
  const appName =
    options.appName ??
    (blank
      ? (repoName as string)
      : ((options.repo as string).replace(/\/+$/, "").split("/").pop() ??
        "Imported app"));

  const created = await runTask(
    blank ? "Creating your repository and app" : "Importing the repository",
    () =>
      createImportedApp({
        appName,
        sourceMode,
        repoUrl: options.repo,
        newRepoName: repoName,
        branch: options.fromBranch,
        prompt: options.prompt,
      }),
  );

  const configPath = await writeAppConfig(targetDir, created.id);
  setAppContext({ id: created.id });

  let finalState: string | undefined;
  let previewUrl: string | undefined;
  let workBranchId: string | undefined;
  if (options.prompt) {
    // The kickoff turn runs on the app's setup branch conversation. Completion
    // is the outcome stamp on the turn's user message — the app status field
    // flaps mid-turn and cannot be trusted.
    const branchId = await soleActiveBranchId().catch(() => undefined);
    workBranchId = branchId;
    if (!jsonMode) {
      log.message(
        "Agent is building — live (several minutes; safe to Ctrl+C, the build continues):",
      );
    }
    const stream = createTurnStream(!jsonMode && process.stdout.isTTY === true);
    let settled: "settled" | "timeout";
    try {
      settled = await streamConversationUntilSettled(
        (event) => {
          if (!jsonMode) stream.onEvent(event);
        },
        { branchId, timeoutMs: POLL_TIMEOUT_MS },
      );
    } finally {
      stream.stop();
    }
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

  const editorUrl = `${getBase44ApiUrl()}/apps/${created.id}/editor/preview`;
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
  log.message(
    name
      ? `Linked ./${name} (${configPath})`
      : `Linked this directory (${configPath})`,
  );

  // Stay in the session: keep taking prompts on the same working branch.
  if (options.prompt && process.stdout.isTTY === true) {
    await runIterationLoop(log, workBranchId);
  }
  const cdHint = name ? ` Next: cd ${name}` : "";
  if (finalState === "error") {
    return {
      outroMessage: `The first build reported an error — open the editor to see what the agent hit.${cdHint}`,
    };
  }
  if (finalState === "processing") {
    return {
      outroMessage: `Still building — check progress in the editor or with \`base44 imported status\`.${cdHint}`,
    };
  }
  return {
    outroMessage: options.prompt
      ? `First build finished.${cdHint}`
      : `Imported app created.${cdHint}`,
  };
}

export function getImportedCreateCommand(): Base44Command {
  const command = new Base44Command("create", { requireAppContext: false });
  command
    .description(
      "Create an imported app: `create <name>` starts from scratch in ./<name>, or import with --repo",
    )
    .argument(
      "[name]",
      "One name for everything: the directory (created for you), the fresh GitHub repo, and the app",
    )
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
