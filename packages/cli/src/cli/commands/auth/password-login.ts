import { dirname, join } from "node:path";
import type { Command } from "commander";
import type { CLIContext, RunCommandResult } from "@/cli/types.js";
import { Base44Command } from "@/cli/utils/index.js";
import { InvalidInputError } from "@/core/errors.js";
import { readProjectConfig } from "@/core/project/index.js";
import {
  DEFAULT_AUTH_CONFIG,
  hasAnyLoginMethod,
  readAuthConfig,
  writeAuthConfig,
} from "@/core/resources/auth-config/index.js";

function validateAction(
  action: string,
): asserts action is "enable" | "disable" {
  if (action !== "enable" && action !== "disable") {
    throw new InvalidInputError(
      `Invalid action "${action}". Must be "enable" or "disable".`,
      {
        hints: [
          {
            message: "Enable password auth:  base44 auth password-login enable",
            command: "base44 auth password-login enable",
          },
          {
            message:
              "Disable password auth: base44 auth password-login disable",
            command: "base44 auth password-login disable",
          },
        ],
      },
    );
  }
}

async function passwordLoginAction(
  { log, runTask }: CLIContext,
  action: string,
): Promise<RunCommandResult> {
  validateAction(action);

  const shouldEnable = action === "enable";
  const { project } = await readProjectConfig();

  const configDir = dirname(project.configPath);
  const authDir = join(configDir, project.authDir);

  const updated = await runTask("Updating local auth config", async () => {
    const current = (await readAuthConfig(authDir)) ?? DEFAULT_AUTH_CONFIG;
    const merged = { ...current, enableUsernamePassword: shouldEnable };
    await writeAuthConfig(authDir, merged);
    return merged;
  });

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
    .argument("<enable|disable>", "enable or disable password authentication")
    .action(passwordLoginAction);
}
