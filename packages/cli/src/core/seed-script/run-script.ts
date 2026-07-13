import { spawn } from "node:child_process";
import { copyFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { file } from "tmp-promise";
import { getSeedWrapperPath } from "@/core/assets.js";
import { getTestOverrides } from "@/core/config.js";
import { createServiceToken } from "@/core/local-state/index.js";
import { getAppUserToken, getSiteUrl } from "@/core/project/api.js";
import { verifyDenoInstalled } from "@/core/utils/index.js";

export interface RunSeedScriptOptions {
  appId: string;
  /** Absolute path of the project's `base44/seed.ts`. */
  scriptPath: string;
  /** Base URL of the running local dev server the script seeds into. */
  localUrl: string;
  /** Test seam: replaces `node:child_process.spawn` (skips the Deno check). */
  spawnImpl?: typeof spawn;
  /** Test seam: wrapper file to run instead of the shipped asset. */
  wrapperPath?: string;
}

export interface RunSeedScriptResult {
  exitCode: number;
}

interface RemoteCredentials {
  accessToken: string;
  appBaseUrl: string;
  error: string;
}

/**
 * Remote credentials power `ctx.remote()` but are optional: scripts that only
 * seed locally must work offline or before the app is published. When the
 * fetch fails, the wrapper throws the recorded reason only if the script
 * actually calls `ctx.remote()`.
 */
async function fetchRemoteCredentials(): Promise<RemoteCredentials> {
  try {
    const [accessToken, appBaseUrl] = await Promise.all([
      getAppUserToken(),
      getSiteUrl(),
    ]);
    return { accessToken, appBaseUrl, error: "" };
  } catch (error) {
    return {
      accessToken: "",
      appBaseUrl: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run the project's `base44/seed.ts` in Deno via the seed wrapper. The
 * wrapper builds the script's `ctx` (local service-role client, `remote()`
 * factory, stderr logger) from the environment below. The child's stdout and
 * stderr are both piped to the CLI's stderr so script output can never
 * corrupt the `--json` stdout contract.
 */
export async function runSeedScript(
  options: RunSeedScriptOptions,
): Promise<RunSeedScriptResult> {
  const override = getTestOverrides()?.seedScript;
  if (override) {
    return { exitCode: override.exitCode };
  }

  if (!options.spawnImpl) {
    verifyDenoInstalled("to run seed scripts");
  }

  // Copy the wrapper to a temp location outside node_modules. Same
  // constraint as the exec wrapper: Deno 2.x treats files inside
  // node_modules as Node modules and blocks npm: specifiers in them.
  const tempWrapper = await file({ postfix: ".ts" });
  try {
    copyFileSync(options.wrapperPath ?? getSeedWrapperPath(), tempWrapper.path);
    const remote = await fetchRemoteCredentials();

    const exitCode = await new Promise<number>((resolvePromise) => {
      const child = (options.spawnImpl ?? spawn)(
        "deno",
        ["run", "--allow-all", "--node-modules-dir=auto", tempWrapper.path],
        {
          env: {
            ...process.env,
            SCRIPT_PATH: pathToFileURL(options.scriptPath).href,
            BASE44_APP_ID: options.appId,
            BASE44_LOCAL_URL: options.localUrl,
            BASE44_LOCAL_SERVICE_TOKEN: createServiceToken(),
            BASE44_ACCESS_TOKEN: remote.accessToken,
            BASE44_APP_BASE_URL: remote.appBaseUrl,
            BASE44_REMOTE_ERROR: remote.error,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      // `end: false` — process.stderr must not be closed when the child exits.
      child.stdout?.pipe(process.stderr, { end: false });
      child.stderr?.pipe(process.stderr, { end: false });
      child.on("error", () => resolvePromise(1));
      child.on("close", (code) => resolvePromise(code ?? 1));
    });

    return { exitCode };
  } finally {
    tempWrapper.cleanup();
  }
}
