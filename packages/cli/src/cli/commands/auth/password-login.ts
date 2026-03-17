import { log } from "@clack/prompts";
import { Command } from "commander";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import {
  getAuthConfig,
  hasAnyLoginMethod,
  updatePasswordAuth,
} from "@/core/auth-config/index.js";
import { InvalidInputError } from "@/core/errors.js";

interface PasswordLoginOptions {
  enable?: true;
  disable?: true;
}

function validateOptions(options: PasswordLoginOptions): void {
  const errors: string[] = [];

  if (!options.enable && !options.disable) {
    errors.push("Missing required flag: specify --enable or --disable");
  }
  if (options.enable && options.disable) {
    errors.push(
      "Conflicting flags: --enable and --disable cannot be used together",
    );
  }

  if (errors.length > 0) {
    throw new InvalidInputError(errors.join("\n"), {
      hints: [
        {
          message: "Enable password auth:  base44 auth password-login --enable",
          command: "base44 auth password-login --enable",
        },
        {
          message:
            "Disable password auth: base44 auth password-login --disable",
          command: "base44 auth password-login --disable",
        },
      ],
    });
  }
}

async function passwordLoginAction(
  options: PasswordLoginOptions,
): Promise<RunCommandResult> {
  validateOptions(options);

  const shouldEnable = !!options.enable;

  const current = await runTask(
    "Fetching current auth config",
    async () => await getAuthConfig(),
  );

  if (shouldEnable === current.enableUsernamePassword) {
    const status = shouldEnable ? "enabled" : "disabled";
    return {
      outroMessage: `Username & password authentication is already ${status}`,
    };
  }

  if (!shouldEnable) {
    const configWithoutPassword = {
      ...current,
      enableUsernamePassword: false,
    };
    if (!hasAnyLoginMethod(configWithoutPassword)) {
      log.warn(
        "Disabling password auth will leave no login methods enabled. Users will be locked out.",
      );
    }
  }

  const action = shouldEnable ? "Enabling" : "Disabling";
  await runTask(
    `${action} username & password authentication`,
    async () => await updatePasswordAuth(shouldEnable),
  );

  const newStatus = shouldEnable ? "enabled" : "disabled";
  return {
    outroMessage: `Username & password authentication ${newStatus}`,
  };
}

export function getPasswordLoginCommand(context: CLIContext): Command {
  return new Command("password-login")
    .description("Enable or disable username & password authentication")
    .option("--enable", "Enable password authentication")
    .option("--disable", "Disable password authentication")
    .action(async (options: PasswordLoginOptions) => {
      await runCommand(
        () => passwordLoginAction(options),
        { requireAuth: true },
        context,
      );
    });
}
