import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { file } from "tmp-promise";
import { getAppClient } from "@/core/clients/index.js";
import { ApiError, DependencyNotFoundError } from "@/core/errors.js";
import { getAppConfig } from "@/core/project/app-config.js";
import { getSiteUrl } from "@/core/site/api.js";

interface RunScriptOptions {
  filePath?: string;
  code?: string;
  extraArgs?: string[];
  execWrapperPath: string;
}

interface RunScriptResult {
  exitCode: number;
}

export function verifyDenoInstalled(): void {
  const result = spawnSync("deno", ["--version"]);
  if (result.error) {
    throw new DependencyNotFoundError(
      "Deno is required to run scripts with exec",
      {
        hints: [
          {
            message:
              "Install Deno: https://docs.deno.com/runtime/getting_started/installation/",
          },
        ],
      },
    );
  }
}

async function getUserAppToken(): Promise<string> {
  try {
    const response = await getAppClient()
      .get("auth/token")
      .json<{ token: string }>();
    return response.token;
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      "exchanging platform token for app user token",
    );
  }
}

export async function runScript(
  options: RunScriptOptions,
): Promise<RunScriptResult> {
  const { filePath, code, extraArgs = [], execWrapperPath } = options;

  verifyDenoInstalled();

  const cleanupFns: (() => void)[] = [];

  let scriptPath: string;

  if (filePath) {
    scriptPath = `file://${resolve(filePath)}`;
  } else if (code !== undefined) {
    const tempScript = await file({ postfix: ".ts" });
    cleanupFns.push(tempScript.cleanup);
    writeFileSync(tempScript.path, code, "utf-8");
    scriptPath = `file://${tempScript.path}`;
  } else {
    throw new Error("Either filePath or code must be provided");
  }

  const appConfig = getAppConfig();
  const [appUserToken, appBaseUrl] = await Promise.all([
    getUserAppToken(),
    getSiteUrl(),
  ]);

  // Copy the exec wrapper to a temp location outside node_modules.
  // This works with both Deno 1.x and 2.x, but is required for Deno 2.x
  // which treats files inside node_modules as Node modules and blocks
  // npm: specifiers in them.
  const tempWrapper = await file({ postfix: ".ts" });
  cleanupFns.push(tempWrapper.cleanup);
  copyFileSync(execWrapperPath, tempWrapper.path);

  try {
    const exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn(
        "deno",
        [
          "run",
          "--allow-all",
          "--node-modules-dir=auto",
          tempWrapper.path,
          ...extraArgs,
        ],
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
