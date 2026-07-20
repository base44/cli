import type { Command } from "commander";
import { createJwtToken } from "@/cli/dev/dev-server/auth/tokens.js";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { DEFAULT_DEV_SERVER_PORT } from "@/core/consts.js";
import { InvalidInputError } from "@/core/errors.js";
import { runScript } from "@/core/exec/index.js";
import { readAuth } from "@/core/index.js";

interface ExecOptions {
  local?: boolean;
  port?: string;
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

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidInputError(`Invalid --port value: "${value}".`, {
      hints: [{ message: "Pass a port number, e.g. --port 4400" }],
    });
  }
  return port;
}

/**
 * Resolve the local `base44 dev` target: the SDK talks to
 * `http://localhost:<port>` authenticated as the current user via a
 * locally-minted dev JWT. The dev server decodes (does not verify) the token,
 * and seeds the current user as an admin, so this matches the local session.
 */
async function resolveLocalTarget(
  port: number,
): Promise<{ serverUrl: string; token: string }> {
  const { email } = await readAuth();
  return {
    serverUrl: `http://localhost:${port}`,
    token: createJwtToken(email),
  };
}

async function execAction(
  { app, isNonInteractive }: CLIContext,
  options: ExecOptions,
): Promise<RunCommandResult> {
  if (options.port !== undefined && !options.local) {
    throw new InvalidInputError("--port can only be used with --local.", {
      hints: [{ message: "Usage: base44 exec --local --port <port>" }],
    });
  }

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

  const local = options.local
    ? await resolveLocalTarget(
        options.port !== undefined
          ? parsePort(options.port)
          : DEFAULT_DEV_SERVER_PORT,
      )
    : undefined;

  const { exitCode } = await runScript({ appId: app!.id, code, local });

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
    .option(
      "--local",
      "Run against the local `base44 dev` server instead of the deployed app",
    )
    .option(
      "--port <number>",
      `Port the local dev server is on (with --local; defaults to ${DEFAULT_DEV_SERVER_PORT})`,
    )
    .addHelpText(
      "after",
      `
Examples:
  Run a script file:
    $ cat ./script.ts | base44 exec

  Inline script:
    $ echo "const users = await base44.entities.User.list()" | base44 exec

  Against the local dev server (base44 dev must be running):
    $ echo "await base44.entities.Task.create({ title: 'seed' })" | base44 exec --local`,
    )
    .action(execAction);
}
