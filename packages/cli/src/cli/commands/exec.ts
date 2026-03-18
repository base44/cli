import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
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

async function execAction(): Promise<RunCommandResult> {
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
    .action(execAction);
}
