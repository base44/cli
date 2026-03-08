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

interface ExecOptions {
  eval?: string;
}

function validateInput(command: Command): void {
  const [scriptArg] = command.args;
  const { eval: evalCode } = command.opts<ExecOptions>();

  const hasStdin = scriptArg === "-";
  const hasFile = scriptArg !== undefined && !hasStdin;
  const hasEval = evalCode !== undefined;

  const inputCount = [hasFile, hasEval, hasStdin].filter(Boolean).length;

  if (inputCount > 1) {
    throw new InvalidInputError(
      "Cannot use more than one input mode. Provide only one of: file path, -e, or -.",
    );
  }

  if (inputCount === 0) {
    throw new InvalidInputError(
      "No script provided. Pass a file path, use -e for inline code, or - for stdin.",
      {
        hints: [
          { message: "File:  base44 exec ./script.ts" },
          { message: 'Eval:  base44 exec -e "console.log(1)"' },
          { message: "Stdin: echo 'code' | base44 exec -" },
        ],
      },
    );
  }
}

async function execAction(
  scriptArg: string | undefined,
  options: ExecOptions,
  extraArgs: string[],
): Promise<RunCommandResult> {
  const hasStdin = scriptArg === "-";
  const hasFile = scriptArg !== undefined && !hasStdin;

  let code: string | undefined;
  if (hasStdin) {
    code = await readStdin();
  } else if (options.eval !== undefined) {
    code = options.eval;
  }

  const { exitCode } = await runScript({
    filePath: hasFile ? scriptArg : undefined,
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
    .argument("[script]", "Path to a .ts/.js file, or - for stdin")
    .option("-e, --eval <code>", "Evaluate inline code")
    .allowUnknownOption(true)
    .hook("preAction", validateInput)
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
