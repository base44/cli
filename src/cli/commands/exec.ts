import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { getAppClient } from "@/core/clients/index.js";
import {
  ApiError,
  DependencyNotFoundError,
  InvalidInputError,
} from "@/core/errors.js";
import { getAppConfig } from "@/core/project/app-config.js";
import { getSiteUrl } from "@/core/site/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXEC_WRAPPER_PATH = join(__dirname, "../deno-runtime/exec.ts");

function verifyDenoIsInstalled(): void {
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

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

interface ExecOptions {
  eval?: string;
  stdin?: boolean;
}

async function execAction(
  scriptArg: string | undefined,
  options: ExecOptions,
  extraArgs: string[],
): Promise<RunCommandResult> {
  let scriptPath: string;
  let tempFile: string | null = null;

  const hasFile = scriptArg !== undefined;
  const hasEval = options.eval !== undefined;
  const hasStdin = options.stdin === true;

  const inputCount = [hasFile, hasEval, hasStdin].filter(Boolean).length;

  if (inputCount > 1) {
    throw new InvalidInputError(
      "Cannot use more than one input mode. Provide only one of: file path, -e, or --stdin.",
    );
  }

  if (inputCount === 0) {
    throw new InvalidInputError(
      "No script provided. Pass a file path, use -e for inline code, or use --stdin.",
      {
        hints: [
          { message: "File:  base44 exec ./script.ts" },
          { message: 'Eval:  base44 exec -e "console.log(1)"' },
          { message: "Stdin: echo 'code' | base44 exec --stdin" },
        ],
      },
    );
  }

  verifyDenoIsInstalled();

  if (hasFile) {
    scriptPath = `file://${resolve(scriptArg!)}`;
  } else {
    // Eval or stdin mode: write to temp file
    const code = hasEval ? options.eval! : await readStdin();
    tempFile = join(tmpdir(), `base44-exec-${Date.now()}.ts`);
    writeFileSync(tempFile, code, "utf-8");
    scriptPath = `file://${tempFile}`;
  }

  // Exchange the platform token for an app user token, and fetch the app's
  // published URL in parallel. Both are required to run the script.
  const appConfig = getAppConfig();
  const [appUserToken, appBaseUrl] = await Promise.all([
    (async () => {
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
    })(),
    getSiteUrl(),
  ]);

  // Copy the exec wrapper out of node_modules to a temp location.
  // Deno 2.x treats files inside node_modules as Node modules and
  // doesn't support npm: specifiers in them.
  const tempWrapper = join(tmpdir(), `base44-exec-wrapper-${Date.now()}.ts`);
  copyFileSync(EXEC_WRAPPER_PATH, tempWrapper);

  try {
    const exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn(
        "deno",
        [
          "run",
          "--allow-all",
          "--node-modules-dir=auto",
          tempWrapper,
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

    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
  } finally {
    for (const f of [tempFile, tempWrapper]) {
      if (f) {
        try {
          unlinkSync(f);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  return {};
}

export function getExecCommand(context: CLIContext): Command {
  const cmd = new Command("exec")
    .description(
      "Run a script with the Base44 SDK pre-authenticated as the current user",
    )
    .argument("[script]", "Path to a .ts or .js script file")
    .option("-e, --eval <code>", "Evaluate inline code")
    .option("--stdin", "Read script from stdin")
    .allowUnknownOption(true)
    .action(async (script: string | undefined, options: ExecOptions) => {
      // Collect everything after "--" as extra args for the Deno process
      const dashIndex = process.argv.indexOf("--");
      const extraArgs =
        dashIndex !== -1 ? process.argv.slice(dashIndex + 1) : [];

      await runCommand(
        () => execAction(script, options, extraArgs),
        { requireAuth: true },
        context,
      );
    });

  return cmd;
}
