import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import chalk from "chalk";
import {
  createTurnStream,
  formatDuration,
} from "@/cli/commands/imported/render.js";
import {
  runInteractiveSession,
  withBootScreen,
} from "@/cli/commands/imported/session.js";
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

const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

const NAME_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "with",
  "to",
  "in",
  "on",
  "that",
  "this",
  "its",
  "it",
  "my",
  "our",
  "your",
  "me",
]);
const FALLBACK_WORDS = [
  "swift-otter",
  "sunny-comet",
  "tidy-maple",
  "brisk-panda",
];

/** A recognizable repo name nobody had to think up: base44-<words from the
 * prompt>-<3 chars> — renameable later, unique enough not to collide. */
function inventRepoName(prompt?: string): string {
  const suffix = Math.random().toString(36).slice(2, 5);
  const words =
    (prompt ?? "")
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((w) => w.length > 2 && !NAME_STOPWORDS.has(w))
      .slice(0, 3) ?? [];
  const core = words.length
    ? words.join("-")
    : FALLBACK_WORDS[Math.floor(Math.random() * FALLBACK_WORDS.length)];
  return `base44-${core}-${suffix}`.slice(0, 60);
}

async function createImportedAction(
  { log, runTask, jsonMode }: CLIContext,
  name: string | undefined,
  options: CreateImportedOptions,
): Promise<RunCommandResult> {
  // The positional name is the whole identity: directory, GitHub repo, app.
  let repoName = options.repoName ?? name;
  // A bare name means "from scratch" — --blank stays for explicitness.
  const blank = options.blank || (Boolean(name) && !options.repo);
  if (blank && options.repo) {
    throw new InvalidInputError(
      "A from-scratch create takes no --repo; drop it, or drop --blank to import that repository.",
    );
  }
  if (!blank && !options.repo) {
    throw new InvalidInputError(
      "Pass a <name> to start from scratch, or --repo <github-url> to import a repository.",
    );
  }
  if (name && !REPO_NAME_RE.test(name)) {
    throw new InvalidInputError(
      "The name becomes a directory and a GitHub repository — letters, digits, dots, dashes and underscores only.",
    );
  }
  if (blank && !repoName) repoName = inventRepoName(options.prompt);

  // The directory carries the same name — explicit or invented.
  const dirName = name ?? (blank ? repoName : undefined);
  const targetDir = dirName ? join(process.cwd(), dirName) : process.cwd();
  if (dirName) await mkdir(targetDir, { recursive: true });
  if (await appConfigExists(targetDir)) {
    throw new InvalidInputError(
      dirName
        ? `./${dirName} is already linked to a Base44 app. Pick another name.`
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

  const interactiveEarly = !jsonMode && process.stdout.isTTY === true;
  const createCall = () =>
    createImportedApp({
      appName,
      sourceMode,
      repoUrl: options.repo,
      newRepoName: repoName,
      branch: options.fromBranch,
      prompt: options.prompt,
    });
  const bootLabel = blank
    ? "creating your repository and app"
    : "importing the repository";
  // Interactive runs start the full-page frame immediately — the create call
  // spins inside it rather than in a clack task outside the page.
  const created = interactiveEarly
    ? await withBootScreen(bootLabel, createCall)
    : await runTask(
        blank ? "Creating your repository and app" : "Importing the repository",
        createCall,
      );

  const configPath = await writeAppConfig(targetDir, created.id);
  // Root discovery (findProjectRoot) keys on a PROJECT config, not .app.jsonc —
  // without this, every later command run from the directory fails to find it.
  const projectConfigPath = join(targetDir, "base44", "config.jsonc");
  await mkdir(join(targetDir, "base44"), { recursive: true });
  try {
    await writeFile(
      projectConfigPath,
      `// Base44 project configuration.\n{\n  "name": ${JSON.stringify(appName)}\n}\n`,
      { flag: "wx" }, // Never clobber an existing project config.
    );
  } catch {
    // Already present — fine.
  }
  setAppContext({ id: created.id, projectRoot: targetDir });

  // The links ride as a sticky footer under the stream (always clickable) and
  // are printed permanently when it ends; non-interactive output gets them up
  // front instead.
  const editorUrl = `${getBase44ApiUrl()}/apps/${created.id}/editor/preview`;
  const interactive = !jsonMode && process.stdout.isTTY === true;
  const footer = [
    ...(created.imported_repo_url
      ? [chalk.dim(`repo    ${created.imported_repo_url}`)]
      : []),
    chalk.dim(`editor  ${editorUrl}`),
  ];
  if (!jsonMode) {
    if (!interactive) for (const line of footer) log.message(line);
    log.message(
      chalk.dim(dirName ? `linked  ./${dirName}` : `linked  ${configPath}`),
    );
  }

  let finalState: string | undefined;
  let previewUrl: string | undefined;
  let buildStartedAt: number | undefined;
  if (options.prompt) {
    // The kickoff turn runs on the app's setup branch conversation. Completion
    // is the outcome stamp on the turn's user message — the app status field
    // flaps mid-turn and cannot be trusted.
    const branchId = await soleActiveBranchId().catch(() => undefined);
    buildStartedAt = Date.now();
    if (interactive) {
      // Full session: the kickoff streams, then the input stays open for
      // follow-up turns. Per-turn outcomes and times print inline.
      await runInteractiveSession({
        branchId,
        footer,
        primeFirstPoll: false,
        awaitingTurnLabel: "provisioning the sandbox and starting the build",
        onTurnSettled: async ({ turnIndex, ok }) => {
          if (turnIndex === 0 && ok && !previewUrl) {
            try {
              previewUrl = await getImportedPreviewUrl();
              footer.push(chalk.dim(`preview ${previewUrl}`));
            } catch {
              // Preview may still be booting; the editor shows it when up.
            }
          }
        },
      });
      return { outroMessage: dirName ? `Next: cd ${dirName}` : "Done." };
    }
    const stream = createTurnStream(false);
    try {
      const settled = await streamConversationUntilSettled(
        (event) => {
          if (!jsonMode) stream.onEvent(event);
        },
        { branchId, timeoutMs: POLL_TIMEOUT_MS },
      );
      finalState =
        settled === "timeout"
          ? "processing"
          : ((await getImportedAppState(created.id)).status?.state ?? "ready");
      if (finalState === "ready") {
        try {
          previewUrl = await getImportedPreviewUrl();
        } catch {
          // Preview may still be booting; the editor shows it when it's up.
        }
      }
    } finally {
      stream.stop();
    }
  }

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

  // Non-interactive runs never draw the pinned block — print the link plainly.
  if (previewUrl && !jsonMode) log.message(`preview ${previewUrl}`);
  const cdHint = dirName ? ` Next: cd ${dirName}` : "";
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
  const buildTook =
    buildStartedAt != null
      ? ` · ${formatDuration(Date.now() - buildStartedAt)}`
      : "";
  return {
    outroMessage: options.prompt
      ? `First build finished${buildTook}.${cdHint}`
      : `Imported app created.${cdHint}`,
  };
}

/** Top-level sugar: `base44 new ["<prompt>"]` or `base44 new <name> ["<prompt>"]`
 * — blank mode with no flags to remember. A lone argument that reads like a
 * sentence is the prompt, and the repo/directory name is invented from it. */
export function getNewCommand(): Base44Command {
  const command = new Base44Command("new", { requireAppContext: false });
  command
    .description(
      "Start a blank app from a prompt — the GitHub repo, directory, and app get an invented base44-* name unless you give one",
    )
    .argument(
      "[nameOrPrompt]",
      "A name for everything, or just the prompt (a name is invented)",
    )
    .argument("[prompt]", "First message for the agent; the build streams live")
    .action(
      (
        ctx: CLIContext,
        nameOrPrompt: string | undefined,
        prompt: string | undefined,
      ) => {
        // One argument that can't be a repo name is the prompt.
        const isName =
          nameOrPrompt !== undefined && REPO_NAME_RE.test(nameOrPrompt);
        const name = isName ? nameOrPrompt : undefined;
        const effectivePrompt = isName ? prompt : (nameOrPrompt ?? prompt);
        return createImportedAction(ctx, name, {
          blank: true,
          prompt: effectivePrompt,
        });
      },
    );
  return command;
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

/** Genesis bootstrap for `base44 code`: turn the session's first prompt into
 * a blank app — invented name, fresh repo, linked directory — and hand back
 * the engine wiring. Emits progress lines into the session scrollback. */
export async function bootstrapBlankApp(
  prompt: string,
  footer: string[],
  emit: (line: string) => void,
): Promise<{
  branchId?: string;
  awaitingTurnLabel: string;
  onTurnSettled: (info: { turnIndex: number; ok: boolean }) => Promise<void>;
}> {
  const repoName = inventRepoName(prompt);
  const created = await createImportedApp({
    appName: repoName,
    sourceMode: "blank",
    newRepoName: repoName,
    prompt,
  });
  const targetDir = join(process.cwd(), repoName);
  await mkdir(join(targetDir, "base44"), { recursive: true });
  await writeAppConfig(targetDir, created.id);
  try {
    await writeFile(
      join(targetDir, "base44", "config.jsonc"),
      `// Base44 project configuration.\n{\n  "name": ${JSON.stringify(repoName)}\n}\n`,
      { flag: "wx" },
    );
  } catch {
    // Already present — fine.
  }
  setAppContext({ id: created.id, projectRoot: targetDir });

  const editorUrl = `${getBase44ApiUrl()}/apps/${created.id}/editor/preview`;
  if (created.imported_repo_url) {
    footer.push(chalk.dim(`repo    ${created.imported_repo_url}`));
  }
  footer.push(chalk.dim(`editor  ${editorUrl}`));
  emit(chalk.dim(`linked  ./${repoName}  (cd ${repoName} after the session)`));

  const branchId = await soleActiveBranchId().catch(() => undefined);
  let previewPushed = false;
  return {
    branchId,
    awaitingTurnLabel: "provisioning the sandbox and starting the build",
    onTurnSettled: async ({ turnIndex, ok }) => {
      if (turnIndex === 0 && ok && !previewPushed) {
        try {
          const previewUrl = await getImportedPreviewUrl();
          previewPushed = true;
          footer.push(chalk.dim(`preview ${previewUrl}`));
        } catch {
          // Preview may still be booting; the editor shows it when up.
        }
      }
    },
  };
}
