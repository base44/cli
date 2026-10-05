import chalk from "chalk";
import {
  appTypeChip,
  assertBuilderApp,
  createAndLinkApp,
  githubReauthLines,
  nextStepsLines,
  repoLabel,
  type WixInstance,
} from "@/cli/commands/builder/shared.js";
import { terminalLink } from "@/cli/commands/code/render.js";
import {
  runGenesisSession,
  runInteractiveSession,
} from "@/cli/commands/code/session.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { type AppIdOptions, Base44Command } from "@/cli/utils/index.js";
import { getBase44ApiUrl } from "@/core/config.js";
import { InvalidInputError } from "@/core/errors.js";
import { getAppContext, initAppContext } from "@/core/project/app-config.js";
import {
  getPreviewUrl,
  resolveActiveBranchId,
} from "@/core/resources/apps/api.js";

const BRAND_ORANGE = "#E86B3C";

type LinkedApp = Awaited<ReturnType<typeof createAndLinkApp>>;

interface CodeOptions {
  import?: string;
  path?: string;
  wixInstance?: string;
  wixClientId?: string;
}

/** Turn the session's first prompt into an app and hand back the engine
 * wiring. Same create + link as `base44 builder new`. */
async function bootstrapApp(
  prompt: string,
  footer: string[],
  emit: (line: string) => void,
  onCreated: (app: LinkedApp) => void,
  importRepo?: string,
  path?: string,
  wixInstance?: WixInstance,
) {
  let app: LinkedApp;
  try {
    app = await createAndLinkApp({ prompt, importRepo, path, wixInstance });
  } catch (error) {
    for (const line of (await githubReauthLines(error)) ?? []) emit(line);
    throw error;
  }
  onCreated(app);
  // The directory stays visible for the whole session, next to the links.
  footer.push(chalk.dim(`dir ${app.here ? "./" : `./${app.dirName}`}`));
  if (app.repoUrl) footer.push(terminalLink("repo", app.repoUrl));
  footer.push(terminalLink("editor", app.editorUrl));
  emit(
    chalk.dim(
      app.here
        ? "linked  ./  (this directory)"
        : `linked  ./${app.dirName}  (cd ${app.dirName} after the session)`,
    ),
  );

  const branchId = await resolveActiveBranchId().catch(() => undefined);
  let previewPushed = false;
  return {
    branchId,
    awaitingTurnLabel: "provisioning the sandbox and starting the build",
    onTurnSettled: async ({
      turnIndex,
      ok,
    }: {
      turnIndex: number;
      ok: boolean;
    }) => {
      // The sandbox may not serve yet after an early or failed turn: keep
      // trying after each settled turn until the preview URL is known.
      void turnIndex;
      void ok;
      if (previewPushed) return;
      const url = await getPreviewUrl().catch(() => undefined);
      if (url) {
        previewPushed = true;
        footer.push(terminalLink("preview", url));
      }
    },
  };
}

async function codeAction(
  { log }: CLIContext,
  options: CodeOptions,
  appId?: string,
): Promise<RunCommandResult> {
  const orange = chalk.hex(BRAND_ORANGE);
  const chip = (label: string) => chalk.dim(`${orange("●")} ${label}`);
  if (process.stdout.isTTY !== true) {
    throw new InvalidInputError(
      "base44 code is an interactive session and needs a terminal.",
    );
  }

  // Inside a linked app, open its session; anywhere else the first prompt
  // creates the app. Must be the real context lookup — an existence glob is
  // recursive and would match apps in subdirectories of an unlinked cwd.
  // --app-id opens that app from anywhere; otherwise a linked directory opens
  // its app, and anywhere else the first prompt creates one.
  let linked = false;
  try {
    await initAppContext(appId ? { appId } : {});
    linked = true;
  } catch {
    // Not linked — genesis below.
  }
  if (linked) {
    if (options.import || options.path || options.wixInstance) {
      throw new InvalidInputError(
        "--import, --path and --wix-instance create a new app; run them outside a linked project, without --app-id.",
      );
    }
    const { id, projectRoot } = getAppContext();
    const state = await assertBuilderApp(id);
    const branchId = await resolveActiveBranchId().catch(() => undefined);
    const footer = [
      chip(appTypeChip(state)),
      ...(state.imported_repo_url
        ? [terminalLink("repo", state.imported_repo_url)]
        : []),
      terminalLink("editor", `${getBase44ApiUrl()}/apps/${id}/editor/preview`),
    ];
    // The preview cold-starts the sandbox; fetch it in the background and pin
    // it when it answers, and again after any turn if it was not up yet.
    let previewPushed = false;
    const pushPreview = async () => {
      if (previewPushed) return;
      const url = await getPreviewUrl().catch(() => undefined);
      if (url && !previewPushed) {
        previewPushed = true;
        footer.push(terminalLink("preview", url));
      }
    };
    void pushPreview();
    await runInteractiveSession({
      branchId,
      footer,
      primeFirstPoll: true,
      idleHint: "what should the agent do next?",
      onTurnSettled: pushPreview,
    });
    if (projectRoot) {
      log.message(chalk.dim(`app dir  ${projectRoot}`));
      return {
        outroMessage: "Session closed. Run `base44 code` here to resume.",
      };
    }
    return {
      outroMessage: `Session closed. Resume with \`base44 code --app-id ${id}\`.`,
    };
  }

  if (options.wixInstance && options.import) {
    throw new InvalidInputError("--wix-instance and --import are exclusive.");
  }
  const wixInstance: WixInstance | undefined = options.wixInstance?.trim()
    ? {
        signedInstance: options.wixInstance.trim(),
        wixClientId: options.wixClientId?.trim() || undefined,
      }
    : undefined;
  let created: LinkedApp | undefined;
  const footer = [
    chip(
      options.import
        ? repoLabel(options.import)
        : wixInstance
          ? "web app · wix"
          : "web app",
    ),
  ];
  await runGenesisSession({
    idleHint: options.import
      ? "describe what to build over the repository"
      : "describe the app you want to build  ·  have one already? base44 code --app-id <id>, or base44 link",
    creatingLabel: options.import
      ? "importing the repository"
      : "creating your app",
    modeLabel: options.import
      ? `Repository — ${repoLabel(options.import)}`
      : wixInstance
        ? "Web app — Wix launch (connector connected first)"
        : "Web app — Base44 template + builder agent",
    footer,
    createApp: (prompt, emit) =>
      bootstrapApp(
        prompt,
        footer,
        emit,
        (app) => {
          created = app;
        },
        options.import,
        options.path,
        wixInstance,
      ),
  });
  if (!created) {
    return { outroMessage: "Session closed. No app was created." };
  }
  for (const line of nextStepsLines(created)) log.message(line);
  log.message(chalk.dim(`  editor  ${created.editorUrl}`));
  return { outroMessage: "Session closed." };
}

export function getCodeCommand(): Base44Command {
  const command = new Base44Command("code", { requireAppContext: false });
  command
    .description(
      "Open Base44 Code, an interactive builder session. In a linked directory (or with --app-id <id>) it opens that app; anywhere else your first prompt creates one (--import <repo> to build over your own repository). Attach a directory to an existing app with base44 link.",
    )
    .option(
      "--import <repo>",
      "Build over an existing GitHub repository instead of the Base44 template",
    )
    .option(
      "--path <dir>",
      "Directory to link the new app to (default: the current directory when empty, else ./<name>)",
    )
    .option(
      "--wix-instance <token>",
      "Create the new app through the Wix route with this signed instance (your first prompt is what the agent runs)",
    )
    .option("--wix-client-id <id>", "The companion OAuth app's client id")
    .action((ctx: CLIContext, options: CodeOptions) =>
      codeAction(ctx, options, command.optsWithGlobals<AppIdOptions>().appId),
    );
  return command;
}
