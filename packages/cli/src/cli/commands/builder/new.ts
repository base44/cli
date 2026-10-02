import chalk from "chalk";
import { Option } from "commander";
import { applyPolicy, ndjsonWriter } from "@/cli/commands/builder/send.js";
import {
  createAndLinkApp,
  githubReauthLines,
  nextStepsLines,
  pendingSummary,
} from "@/cli/commands/builder/shared.js";
import {
  createTurnStream,
  formatDuration,
} from "@/cli/commands/code/render.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import type { ImportSourceMode } from "@/core/resources/apps/api.js";
import {
  getAppState,
  getFullConversation,
  getPreviewUrl,
  resolveActiveBranchId,
} from "@/core/resources/apps/api.js";
import {
  type PendingInput,
  pendingInputs,
} from "@/core/resources/apps/pending.js";
import { streamConversationUntilSettled } from "@/core/resources/apps/stream.js";

const POLL_TIMEOUT_MS = 20 * 60_000;
const MODES: ImportSourceMode[] = ["direct", "fork", "copy"];

interface NewOptions {
  import?: string;
  mode?: string;
  name?: string;
  repoName?: string;
  fromBranch?: string;
  path?: string;
  verbose?: boolean;
  streamJson?: boolean;
  wixInstance?: string;
  wixClientId?: string;
  autoApprove?: boolean;
  skipQuestions?: boolean;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function newAction(
  { log, runTask, jsonMode }: CLIContext,
  prompt: string | undefined,
  options: NewOptions,
): Promise<RunCommandResult> {
  if (options.mode && !MODES.includes(options.mode as ImportSourceMode)) {
    throw new InvalidInputError("--mode must be direct, fork, or copy.");
  }
  if (
    (options.mode || options.repoName || options.fromBranch) &&
    !options.import
  ) {
    throw new InvalidInputError(
      "--mode, --repo-name and --from-branch apply only with --import <repo>.",
    );
  }
  if (options.wixInstance && options.import) {
    throw new InvalidInputError("--wix-instance and --import are exclusive.");
  }
  if (options.wixClientId && !options.wixInstance) {
    throw new InvalidInputError(
      "--wix-client-id applies only with --wix-instance.",
    );
  }
  // "-" reads the token from stdin: a signed instance is a credential and does
  // not belong in shell history or `ps`.
  const signedInstance = options.wixInstance
    ? (options.wixInstance === "-"
        ? await readStdin()
        : options.wixInstance
      ).trim()
    : undefined;
  if (options.wixInstance && !signedInstance) {
    throw new InvalidInputError("--wix-instance is empty.");
  }
  const wixInstance = signedInstance
    ? { signedInstance, wixClientId: options.wixClientId?.trim() || undefined }
    : undefined;
  if (wixInstance && !prompt) {
    throw new InvalidInputError(
      "--wix-instance needs the prompt argument: what the agent should build.",
    );
  }
  if (!prompt && !options.import) {
    throw new InvalidInputError(
      'Describe the app ("<prompt>") or pass --import <repo>.',
    );
  }
  if (options.streamJson && jsonMode) {
    throw new InvalidInputError("--stream-json and --json are exclusive.");
  }
  const ndjson = options.streamJson ? ndjsonWriter() : null;

  let app: Awaited<ReturnType<typeof createAndLinkApp>>;
  try {
    app = await runTask(
      options.import ? "Importing the repository" : "Creating your app",
      () =>
        createAndLinkApp({
          prompt,
          name: options.name,
          importRepo: options.import,
          mode: options.mode as ImportSourceMode | undefined,
          repoName: options.repoName,
          fromBranch: options.fromBranch,
          path: options.path,
          wixInstance,
        }),
    );
  } catch (error) {
    for (const line of (await githubReauthLines(error)) ?? [])
      log.message(line);
    throw error;
  }

  if (ndjson) {
    ndjson({
      type: "created",
      id: app.id,
      repo_url: app.repoUrl ?? null,
      editor_url: app.editorUrl,
      dir: app.dirName,
      path: app.targetDir,
      ...(app.clientCreationId
        ? { client_creation_id: app.clientCreationId }
        : {}),
    });
  } else if (!jsonMode) {
    if (app.repoUrl) log.message(chalk.dim(`repo    ${app.repoUrl}`));
    if (app.clientCreationId) {
      log.message(
        chalk.dim(
          "wix     launched — connector connected before the first turn",
        ),
      );
    }
    log.message(chalk.dim(`editor  ${app.editorUrl}`));
    log.message(
      chalk.dim(
        `linked  ${app.here ? "./  (this directory)" : `./${app.dirName}`}`,
      ),
    );
  }

  let finalState: string | undefined;
  let previewUrl: string | undefined;
  let pending: PendingInput[] = [];
  const startedAt = Date.now();
  if (prompt) {
    // Completion is the outcome on the turn's user message — the app status
    // field flaps mid-turn.
    const branchId = await resolveActiveBranchId().catch(() => undefined);
    // Live spinner while the sandbox provisions and the first turn starts —
    // silent only in --json (stdout must stay pure JSON) or without a TTY.
    const stream = createTurnStream(
      process.stdout.isTTY === true && !jsonMode && !ndjson,
      undefined,
      {
        idleLabel: "provisioning the sandbox and starting the build",
        verbose: options.verbose,
      },
    );
    try {
      const settled = await streamConversationUntilSettled(
        (event) => {
          if (ndjson) {
            const { kind, ...rest } = event;
            ndjson({ type: kind, ...rest });
          } else if (!jsonMode) stream.onEvent(event);
        },
        { branchId, timeoutMs: POLL_TIMEOUT_MS },
      );
      finalState =
        settled === "timeout"
          ? "processing"
          : ((await getAppState(app.id)).status?.state ?? "ready");
      if (settled === "settled") {
        pending = pendingInputs(
          await getFullConversation(30, branchId).catch(() => []),
        );
        if (pending.length && (options.autoApprove || options.skipQuestions)) {
          pending = await applyPolicy(pending, options, branchId, (event) => {
            if (ndjson) {
              const { kind, ...rest } = event;
              ndjson({ type: kind, ...rest });
            } else if (!jsonMode) stream.onEvent(event);
          });
        }
        if (pending.length) finalState = "waiting";
      }
      if (finalState === "ready") {
        previewUrl = await getPreviewUrl().catch(() => undefined);
      }
    } finally {
      stream.stop();
    }
  }

  if (ndjson) {
    ndjson({
      type: "result",
      id: app.id,
      preview_url: previewUrl ?? null,
      status: finalState ?? "created",
      ...(pending.length ? { pending: pendingSummary(pending) } : {}),
    });
    return {};
  }
  if (jsonMode) {
    return {
      stdout: `${JSON.stringify({
        id: app.id,
        repo_url: app.repoUrl ?? null,
        editor_url: app.editorUrl,
        preview_url: previewUrl ?? null,
        dir: app.dirName,
        path: app.targetDir,
        status: finalState ?? "created",
        ...(pending.length ? { pending: pendingSummary(pending) } : {}),
        ...(app.clientCreationId
          ? { client_creation_id: app.clientCreationId }
          : {}),
      })}\n`,
    };
  }
  if (previewUrl) log.message(`preview ${previewUrl}`);
  for (const line of nextStepsLines(app)) log.message(line);
  if (finalState === "waiting") {
    for (const p of pending) log.message(`  ⏸ ${p.title} (${p.kind})`);
    return {
      outroMessage:
        "The agent is waiting on you. Answer with `base44 builder send --approve` (or --choose, --grant, --secret), or open `base44 code`.",
    };
  }
  if (finalState === "error") {
    return {
      outroMessage: `The first build reported an error — open the editor for details.`,
    };
  }
  if (finalState === "processing") {
    return {
      outroMessage: `Still building — follow it with \`base44 builder status\`.`,
    };
  }
  return {
    outroMessage: prompt
      ? `First build finished · ${formatDuration(Date.now() - startedAt)}.`
      : "App created.",
  };
}

export function getNewCommand(): Base44Command {
  const command = new Base44Command("new", { requireAppContext: false });
  command
    .description(
      "Create an app and start building: from a prompt (the Base44 template), or over an existing GitHub repo with --import",
    )
    .argument(
      "[prompt]",
      "What to build; the first agent turn starts immediately",
    )
    .option(
      "--import <repo>",
      "Build over an existing GitHub repository instead of the template",
    )
    .option(
      "--mode <mode>",
      "How to import: direct, fork, or copy (default: direct)",
    )
    .option("--name <name>", "Directory and app name (invented when omitted)")
    .option(
      "--path <dir>",
      "Directory to link (default: the current directory when empty, else ./<name>)",
    )
    .option(
      "--repo-name <name>",
      "Name for the new GitHub repo when forking/copying",
    )
    .option("--from-branch <name>", "Import a specific branch of the repo")
    .addOption(
      new Option(
        "--wix-instance <token>",
        'Create through the Wix route with this signed instance (the Wix connector is connected before the first turn); "-" reads the token from stdin',
      ).env("BASE44_WIX_INSTANCE"),
    )
    .option(
      "--wix-client-id <id>",
      "The companion OAuth app's client id, when the Wix launch has one",
    )
    .option(
      "--auto-approve",
      "Policy: approve approval-kind pauses in the first build (never secrets or browser steps)",
    )
    .option(
      "--skip-questions",
      "Policy: skip clarifying questions; the agent decides",
    )
    .option("--verbose", "Show every tool result in full (no folding)")
    .option(
      "--stream-json",
      "Emit each stream event as a JSON line as it happens, then a final result line",
    )
    .action(newAction);
  return command;
}
