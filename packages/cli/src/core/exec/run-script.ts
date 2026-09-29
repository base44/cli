import { spawn } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { file } from "tmp-promise";
import { getExecWrapperPath } from "@/core/assets.js";
import {
  DATA_ENV_ENV_VAR,
  EXEC_ENV_VARS,
  PRIVILEGED_ENV_VAR,
} from "@/core/exec/env-target.js";
import { getAppUserToken, getSiteUrl } from "@/core/project/api.js";
import { verifyDenoInstalled } from "@/core/utils/index.js";

interface RunScriptOptions {
  appId: string;
  code: string;
  /**
   * When set (a local `base44 dev` server, or an env-supplied target), the
   * SDK's `serverUrl` and access token are taken from here rather than fetched
   * via `getSiteUrl()` / `getAppUserToken()`.
   */
  local?: { serverUrl: string; token: string };
  privileged?: boolean;
  dataEnv?: string;
  /** Passed to `createClient` as `serviceToken`, enabling `base44.asServiceRole`. */
  serviceToken?: string;
}

const DENO_CONFIG = {
  minimumDependencyAge: { exclude: ["npm:@base44/sdk"] },
};

// The wrapper reads and deletes this before the user script runs.
const SERVICE_TOKEN_ENV = "BASE44_SERVICE_TOKEN";

function inheritedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of [
    ...EXEC_ENV_VARS,
    PRIVILEGED_ENV_VAR,
    DATA_ENV_ENV_VAR,
    SERVICE_TOKEN_ENV,
  ]) {
    delete env[name];
  }
  return env;
}

interface RunScriptResult {
  exitCode: number;
}

export async function runScript(
  options: RunScriptOptions,
): Promise<RunScriptResult> {
  const { appId, code, local, privileged, dataEnv, serviceToken } = options;

  verifyDenoInstalled("to run scripts with exec");

  const cleanupFns: (() => void)[] = [];

  const tempScript = await file({ postfix: ".ts" });
  cleanupFns.push(tempScript.cleanup);
  writeFileSync(tempScript.path, code, "utf-8");
  const scriptPath = `file://${tempScript.path}`;

  // Local mode uses the caller-provided token + local server URL; remote mode
  // fetches the app-user token and the published site URL.
  const [appUserToken, appBaseUrl] = local
    ? [local.token, local.serverUrl]
    : await Promise.all([getAppUserToken(), getSiteUrl()]);

  // Copy the exec wrapper to a temp location outside node_modules.
  // This works with both Deno 1.x and 2.x, but is required for Deno 2.x
  // which treats files inside node_modules as Node modules and blocks
  // npm: specifiers in them.
  const tempWrapper = await file({ postfix: ".ts" });
  cleanupFns.push(tempWrapper.cleanup);
  copyFileSync(getExecWrapperPath(), tempWrapper.path);

  // Deno's default minimum dependency age (24h) would refuse the wrapper's pinned
  // SDK right after a release; it keeps applying to everything else.
  const tempConfig = await file({ postfix: ".json" });
  cleanupFns.push(tempConfig.cleanup);
  writeFileSync(tempConfig.path, JSON.stringify(DENO_CONFIG), "utf-8");

  try {
    const exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn(
        "deno",
        // `none` resolves npm: specifiers from Deno's global cache; `auto` would
        // install into the caller's project node_modules (the cwd is kept for
        // the script's relative paths), replacing e.g. its @base44/sdk.
        [
          "run",
          "--allow-all",
          "--node-modules-dir=none",
          "--config",
          tempConfig.path,
          tempWrapper.path,
        ],
        {
          env: {
            ...inheritedEnv(),
            ...(serviceToken ? { [SERVICE_TOKEN_ENV]: serviceToken } : {}),
            SCRIPT_PATH: scriptPath,
            BASE44_APP_ID: appId,
            BASE44_ACCESS_TOKEN: appUserToken,
            BASE44_APP_BASE_URL: appBaseUrl,
            ...(privileged ? { BASE44_PRIVILEGED: "true" } : {}),
            ...(dataEnv ? { BASE44_DATA_ENV: dataEnv } : {}),
          },
          stdio: "inherit",
        },
      );

      child.on("close", (code) => {
        resolvePromise(code ?? 1);
      });
    });

    return { exitCode };
  } finally {
    for (const cleanup of cleanupFns) {
      cleanup();
    }
  }
}
