import { confirm, isCancel, log } from "@clack/prompts";
import { Command } from "commander";
import { CLIExitError } from "@/cli/errors.js";
import type { CLIContext } from "@/cli/types.js";
import { runCommand, runTask } from "@/cli/utils/index.js";
import type { RunCommandResult } from "@/cli/utils/runCommand.js";
import {
  getAuthConfig,
  hasAnyLoginMethod,
  updatePasswordAuth,
} from "@/core/auth-config/index.js";

async function passwordLoginAction(): Promise<RunCommandResult> {
  const current = await runTask(
    "Fetching current auth config",
    async () => await getAuthConfig(),
  );

  const currentStatus = current.enableUsernamePassword ? "enabled" : "disabled";
  log.info(`Username & password authentication is currently ${currentStatus}.`);

  const shouldEnable = await confirm({
    message: "Enable username & password authentication?",
    initialValue: current.enableUsernamePassword,
  });

  if (isCancel(shouldEnable)) {
    throw new CLIExitError(0);
  }

  if (shouldEnable === current.enableUsernamePassword) {
    return {
      outroMessage: `Username & password authentication is already ${currentStatus}`,
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
      const proceed = await confirm({
        message: "Are you sure you want to continue?",
        initialValue: false,
      });
      if (isCancel(proceed) || !proceed) {
        throw new CLIExitError(0);
      }
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
    .action(async () => {
      await runCommand(passwordLoginAction, { requireAuth: true }, context);
    });
}
