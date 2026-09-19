import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import type {
  AppState,
  ImportSourceMode,
  ToolCallAction,
} from "@/core/resources/apps/api.js";
import {
  createApp,
  createImportedApp,
  createWixLaunchedApp,
  getAppState,
  isGithubUserTokenError,
  resolveActiveBranchId,
  startGithubReauth,
} from "@/core/resources/apps/api.js";
import {
  choiceAnswers,
  type PendingInput,
} from "@/core/resources/apps/pending.js";
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

/** What an agent needs to see when the builder is waiting on a person: the
 * pending calls in the same shape the session's cards render from. */
export function pendingSummary(
  pending: PendingInput[],
): Record<string, unknown>[] {
  return pending.map((p) => ({
    id: p.toolCallId,
    kind: p.kind,
    tool: p.tool,
    title: p.title,
    ...(p.detail ? { detail: p.detail } : {}),
    ...(p.questions ? { questions: p.questions } : {}),
    ...(p.answerKey ? { answer_key: p.answerKey } : {}),
    ...(p.secrets ? { secrets: p.secrets.map((x) => x.name) } : {}),
    ...(p.permissions ? { permissions: p.permissions } : {}),
    ...(p.browser ? { browser: p.browser } : {}),
  }));
}

/** The answer flags `builder send` accepts instead of a message. */
export interface AnswerFlags {
  approve?: boolean;
  reject?: boolean;
  skip?: boolean;
  choose?: string[];
  other?: string;
  grant?: string;
  secret?: string[];
  input?: string;
  id?: string;
  /** register_workspace_connector: the connector name; Base44's credentials unless --client-id/--client-secret are given. */
  connectorName?: string;
  clientId?: string;
  clientSecret?: string;
}

export function hasAnswer(f: AnswerFlags): boolean {
  return Boolean(
    f.approve ||
      f.reject ||
      f.skip ||
      f.choose?.length ||
      f.other ||
      f.grant ||
      f.secret?.length ||
      f.input ||
      f.connectorName,
  );
}

/** Resolve a secret flag value: `NAME=env:VAR` reads the environment,
 * `NAME=-` reads stdin, `NAME=file:PATH` reads a file. A bare literal is
 * refused: it would sit in shell history and `ps`. */
async function secretValue(
  spec: string,
  readStdin: () => Promise<string>,
): Promise<[string, string]> {
  const eq = spec.indexOf("=");
  if (eq <= 0) {
    throw new InvalidInputError(
      `--secret expects NAME=env:VAR, NAME=file:PATH or NAME=- (got "${spec}").`,
    );
  }
  const name = spec.slice(0, eq);
  const source = spec.slice(eq + 1);
  if (source === "-") return [name, (await readStdin()).trim()];
  if (source.startsWith("env:")) {
    const v = process.env[source.slice(4)];
    if (!v) {
      throw new InvalidInputError(
        `--secret ${name}: environment variable ${source.slice(4)} is empty.`,
      );
    }
    return [name, v];
  }
  if (source.startsWith("file:")) {
    return [name, (await readFile(source.slice(5), "utf8")).trim()];
  }
  throw new InvalidInputError(
    `--secret ${name}: pass the value as env:VAR, file:PATH or - (stdin), never as plain text.`,
  );
}

/** Turn the answer flags into the tool call's `extra_user_input`. */
export async function buildAnswer(
  pending: PendingInput,
  f: AnswerFlags,
  readStdin: () => Promise<string>,
): Promise<{ action: ToolCallAction; input: Record<string, unknown> }> {
  if (f.reject) return { action: "rejected", input: {} };
  if (f.input) {
    try {
      return {
        action: "approved",
        input: JSON.parse(f.input) as Record<string, unknown>,
      };
    } catch {
      throw new InvalidInputError("--input must be a JSON object.");
    }
  }
  switch (pending.kind) {
    case "choice": {
      if (f.skip) return { action: "approved", input: { answers: [] } };
      const questions = pending.questions ?? [];
      if (!f.choose?.length && !f.other) {
        throw new InvalidInputError(
          "This is a question: answer with --choose <label> per question (comma-separate for multi-select), --other <text>, or --skip.",
        );
      }
      const selections = questions.map((q, i) => {
        const raw = f.choose?.[i];
        const labels = raw
          ? raw
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : [];
        for (const l of labels) {
          if (!q.options.some((o) => o.label === l)) {
            throw new InvalidInputError(
              `"${l}" is not an option for "${q.question}". Options: ${q.options.map((o) => o.label).join(", ")}.`,
            );
          }
        }
        return {
          labels,
          ...(i === questions.length - 1 && f.other
            ? { customText: f.other }
            : {}),
        };
      });
      return {
        action: "approved",
        input: choiceAnswers(questions, selections, pending.answerKey),
      };
    }
    case "permissions": {
      if (!f.approve && !f.grant) {
        throw new InvalidInputError(
          "This asks for permissions: --grant key1,key2 (or --approve for all, --reject).",
        );
      }
      const all = (pending.permissions ?? []).map((p) => p.key);
      const keys = f.grant
        ? f.grant
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : all;
      for (const k of keys) {
        if (!all.includes(k)) {
          throw new InvalidInputError(
            `Unknown permission key "${k}". Keys: ${all.join(", ")}.`,
          );
        }
      }
      return { action: "approved", input: { approved_permission_keys: keys } };
    }
    case "secrets": {
      const names = (pending.secrets ?? []).map((x) => x.name);
      if (!f.secret?.length) {
        throw new InvalidInputError(
          `This asks for secrets: --secret NAME=env:VAR for each of ${names.join(", ")}.`,
        );
      }
      const values: Record<string, string> = {};
      for (const spec of f.secret) {
        const [name, value] = await secretValue(spec, readStdin);
        if (!names.includes(name)) {
          throw new InvalidInputError(
            `"${name}" is not one of the requested secrets: ${names.join(", ")}.`,
          );
        }
        values[name] = value;
      }
      const missing = names.filter((n) => !(n in values));
      if (missing.length) {
        throw new InvalidInputError(
          `Missing --secret for: ${missing.join(", ")}.`,
        );
      }
      return { action: "approved", input: { secrets: values } };
    }
    case "credentials": {
      const name = f.connectorName ?? pending.credentials?.suggestedName;
      if (!name) {
        throw new InvalidInputError(
          "This registers a workspace connector: --connector-name <name> [--client-id <id> --client-secret env:VAR] (omit both to use Base44's credentials).",
        );
      }
      const scopes = pending.credentials?.scopes ?? [];
      if (!f.clientId && !f.clientSecret) {
        return {
          action: "approved",
          input: { name, credential_source: "base44", scopes },
        };
      }
      if (!f.clientId || !f.clientSecret) {
        throw new InvalidInputError(
          "Own credentials need both --client-id and --client-secret.",
        );
      }
      const [, secret] = await secretValue(
        `client_secret=${f.clientSecret}`,
        readStdin,
      );
      return {
        action: "approved",
        input: { name, client_id: f.clientId, client_secret: secret, scopes },
      };
    }
    case "browser":
      throw new InvalidInputError(
        "This step needs a browser: finish the authorization in the editor (or run `base44 code`, which opens the link and waits), then answer with --approve.",
      );
    case "unknown":
      throw new InvalidInputError(
        "This question needs the editor — answer it there, or --reject.",
      );
    default:
      if (!f.approve) {
        throw new InvalidInputError(
          "This is an approval: --approve or --reject.",
        );
      }
      return { action: "approved", input: {} };
  }
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
