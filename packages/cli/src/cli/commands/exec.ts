import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import { InvalidInputError } from "@/core/errors.js";
import { runScript } from "@/core/exec/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXEC_WRAPPER_PATH = join(__dirname, "../deno-runtime/exec.ts");

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

async function execAction(extraArgs: string[]): Promise<RunCommandResult> {
  const noInputError = new InvalidInputError(
    "No input provided. Pipe a script to stdin.",
    {
      hints: [
        { message: "File:  cat ./script.ts | base44 exec" },
        { message: 'Eval:  echo "console.log(1)" | base44 exec' },
      ],
    },
  );

  if (process.stdin.isTTY) {
    throw noInputError;
  }

  const code = await readStdin();

  if (!code.trim()) {
    throw noInputError;
  }

  const { exitCode } = await runScript({
    code,
    extraArgs,
    execWrapperPath: EXEC_WRAPPER_PATH,
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return {};
}

export function getExecCommand(context: CLIContext): Command {
  const cmd = new Command("exec")
    .description(
      "Run a script with the Base44 SDK pre-authenticated as the current user",
    )
    .action(async () => {
      // Collect everything after "--" as extra args for the Deno process
      const dashIndex = process.argv.indexOf("--");
      const extraArgs =
        dashIndex !== -1 ? process.argv.slice(dashIndex + 1) : [];

      await runCommand(
        () => execAction(extraArgs),
        { requireAuth: true },
        context,
      );
    });

  return cmd;
}
