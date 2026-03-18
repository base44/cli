import { spawn } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { file } from "tmp-promise";
import { getExecWrapperPath } from "@/core/assets.js";
import { getAppConfig } from "@/core/project/app-config.js";
import {
  getAppUserToken,
  getSiteUrl,
  verifyDenoInstalled,
} from "@/core/utils/index.js";

interface RunScriptOptions {
  code: string;
}

interface RunScriptResult {
  exitCode: number;
}

export async function runScript(
  options: RunScriptOptions,
): Promise<RunScriptResult> {
  const { code } = options;

  verifyDenoInstalled("to run scripts with exec");

  const cleanupFns: (() => void)[] = [];

  const tempScript = await file({ postfix: ".ts" });
  cleanupFns.push(tempScript.cleanup);
  writeFileSync(tempScript.path, code, "utf-8");
  const scriptPath = `file://${tempScript.path}`;

  const appConfig = getAppConfig();
  const [appUserToken, appBaseUrl] = await Promise.all([
    getAppUserToken(),
    getSiteUrl(),
  ]);

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
            BASE44_APP_ID: appConfig.id,
            BASE44_ACCESS_TOKEN: appUserToken,
            BASE44_APP_BASE_URL: appBaseUrl,
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
