import { spawn, spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { getAppClient } from "@/core/clients/index.js";
import { getBase44ApiUrl } from "@/core/config.js";
import {
  ApiError,
  DependencyNotFoundError,
  InvalidInputError,
} from "@/core/errors.js";
import { getAppConfig } from "@/core/project/app-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXEC_WRAPPER_PATH = join(__dirname, "../deno-runtime/exec.js");

function verifyDenoIsInstalled(): void {
  const result = spawnSync("deno", ["--version"]);
  if (result.error) {
    throw new DependencyNotFoundError(
      "Deno is required to run scripts with exec",
      {
        hints: [
          {
            message:
              "Install Deno: https://docs.deno.com/runtime/getting-started/installation/",
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
}

async function execAction(
  scriptArg: string | undefined,
  options: ExecOptions,
  extraArgs: string[],
): Promise<RunCommandResult> {
  verifyDenoIsInstalled();

  let scriptPath: string;
  let tempFile: string | null = null;

  const hasFile = scriptArg !== undefined;
  const hasEval = options.eval !== undefined;
  // Only consider stdin when no explicit input mode (file/eval) was given
  const isStdinPipe = !hasFile && !hasEval && !process.stdin.isTTY;

  if (hasFile && hasEval) {
    throw new InvalidInputError(
      "Cannot use both a file path and -e flag. Provide only one input mode.",
    );
  }

  if (!hasFile && !hasEval && !isStdinPipe) {
    throw new InvalidInputError(
      "No script provided. Pass a file path, use -e for inline code, or pipe from stdin.",
      {
        hints: [
          { message: "File:  base44 exec ./script.ts" },
          { message: 'Eval:  base44 exec -e "console.log(1)"' },
          { message: "Stdin: echo 'code' | base44 exec" },
        ],
      },
    );
  }

  if (hasFile) {
    scriptPath = `file://${resolve(scriptArg!)}`;
  } else {
    // Eval or stdin mode: write to temp file
    const code = hasEval ? options.eval! : await readStdin();
    tempFile = join(tmpdir(), `base44-exec-${Date.now()}.ts`);
    writeFileSync(tempFile, code, "utf-8");
    scriptPath = `file://${tempFile}`;
  }

  // Exchange the platform token for an app user token
  const appConfig = getAppConfig();
  let appUserToken: string;
  try {
    const response = await getAppClient()
      .get("auth/token")
      .json<{ token: string }>();
    appUserToken = response.token;
  } catch (error) {
    throw await ApiError.fromHttpError(
      error,
      "exchanging platform token for app user token",
    );
  }

  try {
    const exitCode = await new Promise<number>((resolvePromise) => {
      const child = spawn(
        "deno",
        ["run", "--allow-all", "--node-modules-dir=auto", EXEC_WRAPPER_PATH, ...extraArgs],
        {
          env: {
            ...process.env,
            SCRIPT_PATH: scriptPath,
            BASE44_APP_ID: appConfig.id,
            BASE44_ACCESS_TOKEN: appUserToken,
            BASE44_API_URL: getBase44ApiUrl(),
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
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
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
