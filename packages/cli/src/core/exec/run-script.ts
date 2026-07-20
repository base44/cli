import { spawn } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { file } from "tmp-promise";
import { getExecWrapperPath } from "@/core/assets.js";
import { getAppUserToken, getSiteUrl } from "@/core/project/api.js";
import { verifyDenoInstalled } from "@/core/utils/index.js";

interface RunScriptOptions {
  appId: string;
  code: string;
  /**
   * When set, run against a local `base44 dev` server instead of the remote
   * published app: the SDK's `serverUrl` and access token are taken from here
   * rather than fetched via `getSiteUrl()` / `getAppUserToken()`.
   */
  local?: { serverUrl: string; token: string };
  privileged?: boolean;
  dataEnv?: string;
}

interface RunScriptResult {
  exitCode: number;
}

export async function runScript(
  options: RunScriptOptions,
): Promise<RunScriptResult> {
  const { appId, code, local, privileged, dataEnv } = options;

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

  try {
    const exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn(
        "deno",
        ["run", "--allow-all", "--node-modules-dir=auto", tempWrapper.path],
        {
          env: {
            ...process.env,
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
