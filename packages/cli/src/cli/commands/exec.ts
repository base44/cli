import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { runScript } from "@/core/exec/index.js";
import { getAppConfig } from "@/core/project/index.js";

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

async function execAction(
  isNonInteractive: boolean,
): Promise<RunCommandResult> {
  const noInputError = new InvalidInputError(
    "No input provided. Pipe a script to stdin.",
    {
      hints: [
        { message: "File:  cat ./script.ts | base44 exec" },
        {
          message:
            'Eval:  echo "const users = await base44.entities.User.list(); console.log(users)" | base44 exec',
        },
      ],
    },
  );

  if (!isNonInteractive) {
    throw noInputError;
  }

  const code = await readStdin();

  if (!code.trim()) {
    throw noInputError;
  }

  const { exitCode } = await runScript({ appId: getAppConfig().id, code });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }

  return {};
}

export function getExecCommand(): Command {
  return new Base44Command("exec")
    .description(
      "Run a script with the Base44 SDK pre-authenticated as the current user",
    )
    .addHelpText(
      "after",
      `
Examples:
  Run a script file:
    $ cat ./script.ts | base44 exec

  Inline script:
    $ echo "const users = await base44.entities.User.list()" | base44 exec`,
    )
    .action(async ({ isNonInteractive }: CLIContext) => {
      return await execAction(isNonInteractive);
    });
}
