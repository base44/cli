import { dirname, join } from "node:path";
import { log } from "@clack/prompts";
import type { Command } from "commander";
import type { RunCommandResult } from "@/cli/types.js";
import { Base44Command, runTask } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  hasAnyLoginMethod,
  updateAuthConfigFile,
} from "@/core/resources/auth-config/index.js";

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
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const authDir = join(configDir, project.authDir);

  const updated = await runTask(
    `${shouldEnable ? "Enabling" : "Disabling"} username & password authentication`,
    async () => {
      return await updateAuthConfigFile(authDir, {
        enableUsernamePassword: shouldEnable,
      });
    },
  );

  if (!shouldEnable && !hasAnyLoginMethod(updated)) {
    log.warn(
      "Disabling password auth will leave no login methods enabled. Users will be locked out.",
    );
  }

  const newStatus = shouldEnable ? "enabled" : "disabled";
  return {
    outroMessage: `Username & password authentication ${newStatus} in local config. Run \`base44 auth push\` or \`base44 deploy\` to apply.`,
  };
}

export function getPasswordLoginCommand(): Command {
  return new Base44Command("password-login")
    .description("Enable or disable username & password authentication")
    .option("--enable", "Enable password authentication")
    .option("--disable", "Disable password authentication")
    .action(async (options: PasswordLoginOptions) => {
      return passwordLoginAction(options);
    });
}
