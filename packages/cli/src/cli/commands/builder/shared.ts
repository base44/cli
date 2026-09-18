import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import chalk from "chalk";
import { terminalLink } from "@/cli/commands/code/render.js";
import type { CLIContext } from "@/cli/types.js";
import { getBase44ApiUrl } from "@/core/config.js";
import { InvalidInputError } from "@/core/errors.js";
import {
  appConfigExists,
  setAppContext,
  writeAppConfig,
} from "@/core/project/app-config.js";
import type { AppState, ImportSourceMode } from "@/core/resources/apps/api.js";
import {
  createApp,
  createImportedApp,
  createWixLaunchedApp,
  getAppState,
  isGithubUserTokenError,
  resolveActiveBranchId,
  startGithubReauth,
} from "@/core/resources/apps/api.js";
import { isDirEmpty } from "@/core/utils/fs.js";

const APP_NAME_RE = /^[A-Za-z0-9._-]+$/;

const NAME_STOPWORDS = new Set(
  "a an the and or of for with to in on that this its it my our your me".split(
    " ",
  ),
);
const FALLBACK_WORDS = [
  "swift-otter",
  "sunny-comet",
  "tidy-maple",
  "brisk-panda",
];

/** base44-<words from the prompt>-<3 chars>: recognizable, unique enough. */
function inventAppName(prompt?: string): string {
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

function repoBasename(repoUrl: string): string {
  return (
    repoUrl
      .replace(/\/+$/, "")
      .replace(/\.git$/, "")
      .split("/")
      .pop() ?? "app"
  );
}

interface CreateAndLinkOptions {
  prompt?: string;
  /** Directory + app name. Invented from the prompt (builder) or taken from
   * the repo name (import) when omitted. */
  name?: string;
  /** Existing GitHub repository to build over. Omit for a template app. */
  importRepo?: string;
  mode?: ImportSourceMode;
  /** Name for the new GitHub repo when forking/copying. */
  repoName?: string;
  fromBranch?: string;
  /** Directory to link. Default: the current directory when it is empty
   * (same rule as `base44 create`), otherwise ./<name>. */
  path?: string;
  /** Create through the Wix route (connector connected before the first turn). */
  wixInstance?: WixInstance;
}

export interface WixInstance {
  /** The signed Wix instance the funnel minted for this site. */
  signedInstance: string;
  /** The companion OAuth app's client id, when there is one. */
  wixClientId?: string;
}

interface LinkedApp {
  id: string;
  editorUrl: string;
  repoUrl?: string;
  /** Display path relative to where the command ran; "." when linked here. */
  dirName: string;
  targetDir: string;
  /** The app was linked into the directory the command ran in. */
  here: boolean;
  /** Set by the Wix launch route. */
  clientCreationId?: string;
}

/** Create the app (template, or over an existing repo) and link a local
 * directory to it so every later command resolves the app. */
export async function createAndLinkApp(
  options: CreateAndLinkOptions,
): Promise<LinkedApp> {
  if (options.name && !APP_NAME_RE.test(options.name)) {
    throw new InvalidInputError(
      "The name becomes a directory — letters, digits, dots, dashes and underscores only.",
    );
  }
  const cwd = process.cwd();
  const fallbackName = () =>
    options.importRepo
      ? repoBasename(options.importRepo)
      : inventAppName(options.prompt);
  // An explicit --path, or an empty cwd, is the project directory itself and
  // lends the app its name; otherwise the app gets a fresh ./<name>.
  const chosenDir = options.path
    ? resolve(cwd, options.path)
    : (await isDirEmpty(cwd))
      ? cwd
      : undefined;
  const dirBase = chosenDir ? basename(chosenDir) : undefined;
  const name =
    options.name ??
    (dirBase && APP_NAME_RE.test(dirBase) ? dirBase : fallbackName());
  const targetDir = chosenDir ?? join(cwd, name);
  const here = targetDir === cwd;
  const dirName = here ? "." : relative(cwd, targetDir) || name;
  await mkdir(targetDir, { recursive: true });
  if (await appConfigExists(targetDir)) {
    throw new InvalidInputError(
      here
        ? "This directory is already linked to a Base44 app. Run `base44 code` here to keep building it, or pass --path for a new one."
        : `./${dirName} is already linked to a Base44 app. Pick another name or --path.`,
    );
  }

  let clientCreationId: string | undefined;
  const created = options.wixInstance
    ? await createWixLaunchedApp({
        prompt: options.prompt ?? "",
        signedInstance: options.wixInstance.signedInstance,
        wixClientId: options.wixInstance.wixClientId,
      }).then((c) => {
        clientCreationId = c.client_creation_id;
        return c;
      })
    : options.importRepo
      ? await createImportedApp({
          appName: name,
          repoUrl: options.importRepo,
          sourceMode: options.mode ?? "direct",
          newRepoName: options.repoName,
          branch: options.fromBranch,
          prompt: options.prompt,
        })
      : await createApp({ appName: name, prompt: options.prompt });

  await writeAppConfig(targetDir, created.id);
  // Root discovery keys on a PROJECT config, not .app.jsonc.
  await mkdir(join(targetDir, "base44"), { recursive: true });
  try {
    await writeFile(
      join(targetDir, "base44", "config.jsonc"),
      `// Base44 project configuration.\n{\n  "name": ${JSON.stringify(name)}\n}\n`,
      { flag: "wx" },
    );
  } catch {
    // Already present.
  }
  setAppContext({ id: created.id, projectRoot: targetDir });

  return {
    id: created.id,
    editorUrl: `${getBase44ApiUrl()}/apps/${created.id}/editor/preview`,
    repoUrl: created.imported_repo_url ?? undefined,
    dirName,
    targetDir,
    here,
    ...(clientCreationId ? { clientCreationId } : {}),
  };
}

/** Repository shown the way people say it: no scheme, no trailing .git. */
export function repoLabel(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

/** What kind of app this is, for the session chip. Template apps are "web
 * app"; an app built over a repository shows the repository itself. */
export function appTypeChip(state: AppState): string {
  switch (state.app_type ?? "user_app") {
    case "imported_app":
      return state.imported_repo_url
        ? repoLabel(state.imported_repo_url)
        : "repository app";
    case "user_game":
      return "game";
    case "mobile_app":
      return "mobile app";
    case "slide":
      return "slides";
    case "user_agent":
      return "superagent";
    default:
      return "web app";
  }
}

/** The builder only works on apps it manages. A code-first project (base44
 * create) owns its own source, and a Superagent has no builder conversation;
 * sending them a turn would act on a copy nobody sees or fail obscurely. */
export async function assertBuilderApp(appId: string): Promise<AppState> {
  const state = await getAppState(appId);
  if (state.is_managed_source_code === false) {
    throw new InvalidInputError(
      "This project is code-first (base44 create): you own the source and the builder cannot work on it. Run `base44 builder new` for an agent-built app.",
    );
  }
  if (state.app_type === "user_agent") {
    throw new InvalidInputError(
      "This is a Superagent, not an app the builder works on. Superagent has no CLI surface yet.",
    );
  }
  return state;
}

/** Lines to show when a create failed because the caller's GitHub OAuth token
 * expired (a 401 from api.github.com); null for any other error. A plain
 * retry just fails again — the fix is re-authorizing. */
/** Where the app landed and how to pick it up again — the last thing both
 * `app new` and a genesis `code` session print, so the directory is never a
 * surprise after the run. */
export function nextStepsLines(app: LinkedApp): string[] {
  const cd = app.here ? "" : `cd ${app.dirName} && `;
  return [
    "",
    `${chalk.bold("Your app lives in")}  ${app.here ? "./  (this directory)" : `./${app.dirName}`}`,
    chalk.dim(`  ${cd}base44 code        # keep building with the agent`),
    chalk.dim(`  ${cd}base44 builder send "…"  # one non-interactive turn`),
    chalk.dim(
      `  files live remotely — ${cd}base44 sandbox ls to look, base44 eject for a copy`,
    ),
  ];
}

export async function githubReauthLines(
  error: unknown,
): Promise<string[] | null> {
  if (!isGithubUserTokenError(error)) return null;
  const link = await startGithubReauth().catch(() => null);
  return [
    "Your GitHub authorization expired. Reconnect, then run this again:",
    link
      ? terminalLink("Reconnect GitHub", link)
      : "Open Base44 → GitHub settings to reconnect your account.",
  ];
}

/** Explicit --branch wins; otherwise the app's single active branch (an
 * import's setup branch). Undefined targets main, which is right for a
 * template app. */
export async function resolveBranchId(
  ctx: CLIContext,
): Promise<string | undefined> {
  return ctx.branchId ?? (await resolveActiveBranchId().catch(() => undefined));
}
